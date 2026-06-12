import asyncio
import logging
from database import SessionLocal
from models_db import SystemSettings, OLTProfileDB
from network_manager import network_mgr
from security_utils import decrypt_password
from globals import get_active_manual_ops

logger = logging.getLogger(__name__)

class SyncAgent:
    def __init__(self):
        self.is_running = False
        self.current_state = "NO_CONNECTION" # MATCH, MISMATCH, NO_CONNECTION, DB_OFFLINE, LOADING, NO_PROFILE
        self.verified_olt_id = None
        self.detected_olt_id = None
        self.active_ip = None
        self.sync_event = asyncio.Event()
        self.listeners = [] # Async queues to broadcast states
        self.terminal_active_count = 0 # Track how many terminal tabs are open
        self.type_keywords = {
            "c600": ["C600", "ZXAN-C600", "SFUB", "SFUL", "SFQD", "SFUC"],
            "c300": ["C300", "ZXAN-C300", "SCXN", "SCXM", "SCXL"],
            "c320": ["C320", "ZXAN-C320", "SMXA", "PRAM"]
        }
        self._last_yield_time = 0
        self._last_ops_count = 0

    def register_listener(self, queue: asyncio.Queue):
        self.listeners.append(queue)

    def unregister_listener(self, queue: asyncio.Queue):
        if queue in self.listeners:
            self.listeners.remove(queue)

    async def broadcast_state(self):
        payload = {
            "type": "agent_state_update",
            "state": self.current_state,
            "activeOltId": self.verified_olt_id,
            "detectedOltId": self.detected_olt_id,
            "activeIp": self.active_ip
        }
        for q in self.listeners:
            await q.put(payload)

    async def start(self):
        if self.is_running: return
        self.is_running = True
        logger.info("Live Network Agent Started")
        asyncio.create_task(self._loop())

    def stop(self):
        self.is_running = False

    def trigger_sync(self):
        """Signal the agent to re-sync immediately."""
        self.sync_event.set()
        
    async def _get_profile_and_target(self):
        """Helper to get data from DB without blocking the event loop."""
        def sync_db_op():
            db = SessionLocal()
            try:
                # 1. Always prioritize user's Master Selection (Dashboard Toggle) or ENV override
                import os
                selected_type = os.getenv("SELECTED_OLT_ID")
                if not selected_type:
                    sel_setting = db.query(SystemSettings).filter(SystemSettings.key == "selected_olt_id").first()
                    selected_type = sel_setting.value if sel_setting else None
                
                if selected_type:
                    profile = db.query(OLTProfileDB).filter(OLTProfileDB.olt_type == selected_type).first()
                    if profile:
                        return profile.in_band_ip, profile, selected_type
                    # If type selected but no profile yet, return just the type
                    return None, None, selected_type

                # 2. ONLY fallback to current_active_olt_ip if no master selection exists
                setting = db.query(SystemSettings).filter(SystemSettings.key == "current_active_olt_ip").first()
                if not setting or not setting.value:
                    return None, None, None
                
                active_ip = setting.value
                profile = db.query(OLTProfileDB).filter(OLTProfileDB.in_band_ip == active_ip).first()
                if profile:
                    return active_ip, profile, profile.olt_type
                return active_ip, None, None
            finally:
                db.close()
        return await asyncio.to_thread(sync_db_op)

    async def _update_ip_in_db(self, ip: str):
        def sync_update():
            db = SessionLocal()
            try:
                ip_setting = db.query(SystemSettings).filter(SystemSettings.key == "current_active_olt_ip").first()
                if ip_setting:
                    ip_setting.value = ip
                else:
                    db.add(SystemSettings(key="current_active_olt_ip", value=ip))
                db.commit()
            finally:
                db.close()
        await asyncio.to_thread(sync_update)

    async def _loop(self):
        while self.is_running:
            self.sync_event.clear()
            try:
                # Priority Yielding (Brain-Back Standby Mode)
                from globals import get_active_manual_ops, is_system_active
                if not is_system_active(): # Default 8-hour timeout
                    logger.debug("SyncAgent entering standby (system inactive)...")
                    await asyncio.sleep(10)
                    continue

                ops = get_active_manual_ops()
                if ops > 0:
                    # Throttle logging: only log if ops count changed OR 30s passed
                    now = asyncio.get_event_loop().time()
                    if ops != self._last_ops_count or (now - self._last_yield_time > 30):
                        logger.info(f"SyncAgent fast-yielding to {ops} manual operations...")
                        self._last_yield_time = now
                        self._last_ops_count = ops
                    
                    await asyncio.sleep(0.5)
                    continue
                
                # Reset throttle when back to normal
                self._last_ops_count = 0
                # 1. Fetch Master Selection and corresponding profile
                db = SessionLocal()
                # 2. Critical: If switching OLT, UI enters LOADING mode immediately
                # (The trigger endpoint sets self.current_state = "LOADING")
                # 2. Get the currently selected OLT ID (User Choice) or ENV override
                import os
                selected_olt_id = os.getenv("SELECTED_OLT_ID")
                if not selected_olt_id:
                    from models_db import SystemSettings, OLTProfileDB
                    sel_setting = db.query(SystemSettings).filter(SystemSettings.key == "selected_olt_id").first()
                    selected_olt_id = sel_setting.value if sel_setting else None
                
                if not selected_olt_id:
                    self.current_state = "NO_PROFILE"
                    await self.broadcast_state()
                    db.close()
                    await asyncio.sleep(5)
                    continue

                # 3. Get the IP for this selected OLT from its profile
                profile = db.query(OLTProfileDB).filter(OLTProfileDB.olt_type == selected_olt_id).first()
                target_ip = profile.in_band_ip if profile else None

                if not target_ip:
                    self.current_state = "NO_PROFILE"
                    await self.broadcast_state()
                    db.close()
                    await asyncio.sleep(5)
                    continue

                self.active_ip = target_ip
                logger.debug(f"SyncAgent checking OLT {selected_olt_id} at {target_ip}")
                # db.close() moved to finally
                
                # 3. Network Discovery & Identity Verification
                target_hostname = profile.hostname if profile else "ZXAN"
                
                # Decrypt credentials
                decrypted_password = decrypt_password(profile.password, db)
                decrypted_enable = decrypt_password(profile.enable_password, db)
                
                # Broadcaster says we are checking...
                if self.current_state != "LOADING" and self.current_state != "MATCH":
                    self.current_state = "LOADING"
                    await self.broadcast_state()

                # User requested: Skip ping if already connected/matched.
                # Direct transition to MATCH if we have a profile and IP.
                if self.current_state == "MATCH":
                    # Just keep existing state and wait
                    await self.broadcast_state()
                    try:
                        await asyncio.wait_for(self.sync_event.wait(), timeout=10.0)
                    except asyncio.TimeoutError:
                        pass
                    continue

                # If NOT matched, we check ping and identity (Legacy flow for initial discovery)
                telnet_port = profile.telnet_port if profile and profile.telnet_port else 23
                is_reachable = await network_mgr.check_ping(target_ip, port=telnet_port)
                
                if not is_reachable:
                    # Ping failed — but some OLTs (e.g. C600) block ICMP.
                    # Don't give up yet: fall through to Telnet verification as fallback.
                    logger.info(f"Ping failed for {target_ip}, attempting Telnet fallback...")

                # NEW: If we are already MATCHED and Ping is still alive, don't re-verify identity
                # to avoid spamming Telnet login attempts and causing "connection closed" errors.
                if self.current_state == "MATCH" and self.active_ip == target_ip:
                    # Just broadcast and wait
                    await self.broadcast_state()
                    try:
                        await asyncio.wait_for(self.sync_event.wait(), timeout=5.0)
                    except asyncio.TimeoutError:
                        pass
                    continue

                # NEW: If terminal is active, skip identity verification to avoid ghost typing
                if self.terminal_active_count > 0:
                    logger.info("Terminal is active, SyncAgent skipping hardware commands to avoid interference.")
                    # If we weren't MATCHED, we stay in LOADING
                    if self.current_state != "MATCH":
                        self.current_state = "LOADING"
                        await self.broadcast_state()
                    await asyncio.sleep(10)
                    continue

                # Try Telnet connection using DB credentials ONLY if we are not matched
                # and we haven't failed too recently.
                found_match = False
                connected = await network_mgr.connect(
                    target_ip, profile.telnet_port, profile.username, 
                    decrypted_password, decrypted_enable, timeout=3.0
                )
                if connected:
                    actual_host = network_mgr.hostname
                    # Strict validation: Check OLT version string via Telnet
                    try:
                        version_info = await network_mgr.execute_command("show version-running")
                        card_info = await network_mgr.execute_command("show card")
                        
                        handshake_blob = (version_info + card_info).upper()
                        
                        detected_type = None
                        for t_id, keywords in self.type_keywords.items():
                            if any(kw.upper() in handshake_blob for kw in keywords):
                                detected_type = t_id
                                break
                        
                        self.detected_olt_id = detected_type
                        
                        expected_keywords = self.type_keywords.get(selected_olt_id.lower(), [])
                        id_matches = any(kw.upper() in handshake_blob for kw in expected_keywords)
                        
                        if id_matches:
                            found_match = True
                            self.active_ip = target_ip
                            self.current_state = "MATCH"
                            self.verified_olt_id = selected_olt_id
                            network_mgr.connected_ip = target_ip
                        else:
                            logger.warning(f"OLT Identity Mismatch! Expected {selected_olt_id}, but hardware says otherwise.")
                            self.current_state = "MISMATCH"
                            await network_mgr.disconnect()
                    except Exception as ver_err:
                        # If we can't run version command, we just stay in a generic "Online" state but not fully matched
                        logger.info(f"Identity verification failed (command error): {ver_err}")
                        await network_mgr.disconnect()
                        # Fallback: if we were previously MATCH, don't drop the state just because of a transient error
                        if self.current_state == "MATCH":
                            found_match = True
                else:
                    # Telnet failed, but Ping succeeded.
                    if self.current_state == "MATCH":
                        # Keep current MATCH state if we were already verified (trust existing connection)
                        found_match = True
                    else:
                        # NEW: Do NOT automatically match just because of Ping.
                        # If it's a new connection, we need Telnet to verify identity.
                        logger.warning(f"Telnet failed for {target_ip}. Identity cannot be verified yet.")
                        self.current_state = "NO_CONNECTION"
                        found_match = False

                if not found_match:
                    self.current_state = "MISMATCH"
                    self.verified_olt_id = selected_olt_id
                    self.active_ip = None
                    network_mgr.connected_ip = None
                    
                await self.broadcast_state()
                
            except Exception as e:
                import traceback
                logger.error(f"SyncAgent loop error: {e}\n{traceback.format_exc()}")
            finally:
                if 'db' in locals():
                    db.close()
                
            # Wait 5s or until a manual sync is triggered
            try:
                await asyncio.wait_for(self.sync_event.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                pass

agent = SyncAgent()
