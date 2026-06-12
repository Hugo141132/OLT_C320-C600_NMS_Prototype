"""
OLT-WEB Hardware Agent — Local-only FastAPI backend.

Provides:
  - REST endpoints for port scanning, connecting, disconnecting, and status
  - WebSocket endpoint for bidirectional terminal I/O
  - Background auto-detection of USB-to-Serial adapters

Binds to 127.0.0.1 only for security.
"""

import asyncio
import json
import logging
import re
import telnetlib
import time
import threading
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Optional, List, Union

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from sqlalchemy.orm import Session
from fastapi import Depends, HTTPException, Response, Request, Cookie
from database import get_db, SessionLocal
from models_db import User, OLTProfileDB, SystemSettings, ONUCLILog, UnregisteredONU, UnconfiguredONU, ConfiguredONU, ONUPowerHistory, VLANRecord

import secrets

from serial_manager import SerialManager, PortInfo
from network_manager import network_mgr
from sync_agent import agent
import snmp_manager as snmp
from snmp_manager import OID, ONU_PHASE_STATE_MAP, CARD_STATUS_MAP, decode_snmp_ascii

import security_utils
from globals import (
    increment_manual_ops, decrement_manual_ops, get_active_manual_ops,
    update_activity, is_system_active
)
from security_utils import (
    get_password_hash, verify_password, 
    encrypt_password, decrypt_password,
    create_session_token, parse_session_token
)

def get_selected_olt_id(db: Session) -> Optional[str]:
    import os
    env_val = os.getenv("SELECTED_OLT_ID")
    if env_val:
        return env_val
    setting = db.query(SystemSettings).filter(SystemSettings.key == "selected_olt_id").first()
    return setting.value if (setting and setting.value) else None

# ── Logging ─────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(name)-14s  %(levelname)-7s  %(message)s",
)
logger = logging.getLogger("olt-backend")

# Fix passlib/bcrypt compatibility issue
try:
    import bcrypt
    if not hasattr(bcrypt, "__about__"):
        bcrypt.__about__ = type('About', (object,), {'__version__': bcrypt.__version__})
except ImportError:
    pass

# Persistent Session Helpers
def _set_db_setting(db: Session, key: str, value: str):
    from models_db import SystemSettings
    setting = db.query(SystemSettings).filter(SystemSettings.key == key).first()
    if setting:
        setting.value = value
    else:
        db.add(SystemSettings(key=key, value=value))
    db.commit()

def _get_db_setting(db: Session, key: str) -> Optional[str]:
    from models_db import SystemSettings
    setting = db.query(SystemSettings).filter(SystemSettings.key == key).first()
    return setting.value if setting else None

def get_client_ip(request: Request) -> str:
    """Helper to extract real client IP even behind proxies."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        # Get the first IP in the list (the original client IP)
        client_ip = forwarded.split(",")[0].strip()
        # In a strict environment, you would validate if request.client.host is a trusted proxy IP here.
        return client_ip
    return request.client.host if request.client else "unknown"

async def get_current_user(request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get("olt_session")
    client_ip = get_client_ip(request)
    
    # 1. Standard Cookie Check
    if token:
        user_data = parse_session_token(token, db)
        if user_data:
            update_activity()
            _set_db_setting(db, "last_admin_ip", client_ip)
            return user_data

    raise HTTPException(status_code=401, detail="Not authenticated")

def admin_required(current_user = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return current_user

# ── State ───────────────────────────────────────────────────────────────

serial_mgr = SerialManager()

# Multi-tab broadcast: track all connected terminal WebSocket clients
active_ws_clients: set["WebSocket"] = set()
active_ws_clients_lock = asyncio.Lock()

# Track detected port events for broadcasting
latest_detected_port: Optional[PortInfo] = None

# Cache for VLAN summary (IDs)
# Format: { "olt_ip": [vlan_id, ...] }
vlan_summary_cache = {}
vlan_summary_cache_time = {} # Format: { "olt_ip": float_timestamp }

# Cache for VLAN names to speed up provisioning tables
# Format: { "olt_ip": { vlan_id: {"name": "...", "time": float_timestamp} } }
vlan_name_cache = {}

# Cache for ONU Profiles
# Format: { "olt_ip": [profile_dict, ...] }
onu_profile_cache = {}
onu_profile_cache_time = {} # Format: { "olt_ip": float_timestamp }

# Cache for TCONT Profiles
tcont_profile_cache = {}
tcont_profile_cache_time = {} # Format: { "olt_ip": float_timestamp }

# Cache for C3xx ONU List
c3xx_onu_cache = {}
c3xx_onu_cache_time = {}

# Cache for OLT Cards
olt_card_cache = {}
olt_card_cache_time = {}

# Cache for OLT Vitals
vitals_cache = {}
vitals_cache_time = {}

# Persistent JSON Cache for OLT Cards to prevent data loss during hot-reloads
import os
CACHE_DIR = "scratch"
CACHE_FILE = os.path.join(CACHE_DIR, "olt_cards_cache.json")

def save_cards_cache():
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(CACHE_FILE, "w") as f:
            json.dump({
                "cache": olt_card_cache,
                "time": olt_card_cache_time
            }, f)
    except Exception as e:
        logger.error(f"Failed to save cards cache to disk: {e}")

def load_cards_cache():
    global olt_card_cache, olt_card_cache_time
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r") as f:
                data = json.load(f)
                olt_card_cache.update(data.get("cache", {}))
                olt_card_cache_time.update(data.get("time", {}))
                logger.info(f"[CARDS] Loaded {len(olt_card_cache)} entries from persistent JSON cache.")
        except Exception as e:
            logger.error(f"Failed to load cards cache from disk: {e}")

# Load persistent cache on startup
load_cards_cache()

# Cache for enriched ONU detail list (TTL 60s)
onu_detail_cache = {}        # { olt_ip: [onu_dict, ...] }
onu_detail_cache_time = {}   # { olt_ip: float_timestamp }

# Cache for Dashboard ONU stats (TTL 60s)
dashboard_stats_cache = {}     # { olt_ip: stats_dict }
dashboard_stats_cache_time = {} # { olt_ip: float_timestamp }

# Shared thread pool for parallel per-ONU CLI enrichment (max 5 concurrent Telnet ops)
_onu_detail_executor = ThreadPoolExecutor(max_workers=5, thread_name_prefix="onu-detail")

# ── SingleFlight: Cache Stampede Protection ──────────────────────────────────
# Ensures only ONE backend fetch (SNMP/Telnet) runs per cache key at a time.
# All concurrent requests for the same key wait for the single in-flight fetch
# and receive the same result, preventing OLT overload with 10+ simultaneous users.

class SingleFlight:
    """
    Prevents cache stampede by ensuring only one fetch runs per key at a time.
    All other waiters receive the result of the single in-flight request.

    Usage (async endpoints):
        result = await _sf.do(key, async_fetch_fn)

    Usage (sync endpoints — wraps a sync callable):
        result = await _sf.do(key, lambda: sync_fetch_fn())
    """

    def __init__(self):
        self._in_flight: dict[str, asyncio.Future] = {}
        self._lock = asyncio.Lock()

    async def do(self, key: str, fetch_fn):
        """
        Execute fetch_fn exactly once per key when concurrent requests arrive.
        Returns the shared result to all waiters.
        """
        async with self._lock:
            if key in self._in_flight:
                # A fetch is already running — attach to its future
                future = self._in_flight[key]
                is_leader = False
            else:
                # We are the first — create the future and start the fetch
                loop = asyncio.get_event_loop()
                future = loop.create_future()
                self._in_flight[key] = future
                is_leader = True

        if not is_leader:
            # Wait for the leader's result
            try:
                return await asyncio.shield(future)
            except Exception:
                raise

        # Leader: run the fetch and broadcast result to all waiters
        try:
            if asyncio.iscoroutinefunction(fetch_fn):
                result = await fetch_fn()
            else:
                result = await asyncio.get_event_loop().run_in_executor(None, fetch_fn)
            future.set_result(result)
            return result
        except Exception as exc:
            future.set_exception(exc)
            raise
        finally:
            async with self._lock:
                self._in_flight.pop(key, None)

# Singleton instance — shared across all endpoints
_sf = SingleFlight()

class TelnetSessionManager:
    """Manages persistent Telnet sessions to avoid repeated login overhead."""
    def __init__(self):
        self.sessions = {} # {ip: telnet_obj}
        self.last_used = {} # {ip: timestamp}
        self.locks = {} # {ip: threading.Lock}
        self.global_lock = threading.Lock()
        # Start keepalive thread
        threading.Thread(target=self._keepalive_loop, daemon=True).start()

    def _keepalive_loop(self):
        """Periodically sends a newline to keep sessions alive (like MobaXterm)."""
        while True:
            time.sleep(45) # Every 45 seconds
            
            # Hibernation: If no one is logged in, don't touch the OLT
            if not is_system_active(timeout=300):
                continue

            with self.global_lock:
                for ip in list(self.sessions.keys()):
                    try:
                        tn = self.sessions.get(ip)
                        if tn:
                            tn.get_socket().send(b"\n")
                    except:
                        # Silent failure, get_session will handle reconnection
                        pass

    def get_lock(self, ip):
        with self.global_lock:
            if ip not in self.locks:
                self.locks[ip] = threading.Lock()
            return self.locks[ip]

    def reset_all(self):
        """Forcefully closes and clears ALL sessions to recover from ghost session limits."""
        with self.global_lock:
            for ip in list(self.sessions.keys()):
                try:
                    logger.info(f"Forcing hard reset of Telnet session to {ip}")
                    self.sessions[ip].close()
                except: pass
                self.sessions.pop(ip, None)
                self.last_used.pop(ip, None)
            logger.info("All Telnet sessions have been forcefully cleared.")

    def get_session(self, ip, user, password, enable_pwd, port=23):
        now = time.time()
        
        # Clean up stale sessions (> 10 minutes idle)
        with self.global_lock:
            for old_ip, last_time in list(self.last_used.items()):
                if now - last_time > 600:
                    if old_ip in self.sessions:
                        try: self.sessions[old_ip].close()
                        except: pass
                        del self.sessions[old_ip]
                    del self.last_used[old_ip]

        # Reuse existing session if possible
        if ip in self.sessions:
            tn = self.sessions[ip]
            try:
                # If no prompt, maybe it needs a newline to wake up
                tn.write(b"\n")
                idx, _, _ = tn.expect([b"#", b">"], timeout=0.5)
                
                if idx == 1: # Got ">", dropped out of enable mode
                    tn.write(b"enable\n")
                    tn.read_until(b"Password:", timeout=5)
                    tn.write(enable_pwd.encode('ascii') + b"\n")
                    tn.read_until(b"#", timeout=5)
                    self.last_used[ip] = now
                    return tn
                elif idx == 0: # Got "#", still in enable mode
                    self.last_used[ip] = now
                    return tn
                    
            except (Exception, ConnectionResetError) as e:
                logger.info(f"Persistent session for {ip} lost ({e}), reconnecting...")
                try: tn.close()
                except: pass
                del self.sessions[ip]
                if ip in self.last_used: del self.last_used[ip]

        # New Connection & Login
        try:
            logger.info(f"Opening new persistent Telnet session to {ip} on port {port}...")
            tn = telnetlib.Telnet(ip, port, timeout=10)
            
            # Login
            tn.read_until(b"Username:", timeout=5)
            tn.write(user.encode('ascii') + b"\n")
            tn.read_until(b"Password:", timeout=5)
            tn.write(password.encode('ascii') + b"\n")
            
            # Mode Enable
            tn.write(b"enable\n")
            tn.read_until(b"Password:", timeout=5)
            tn.write(enable_pwd.encode('ascii') + b"\n")
            tn.read_until(b"#", timeout=5)
            
            # Disable terminal length
            tn.write(b"terminal length 0\n")
            tn.read_until(b"#", timeout=5)
            
            self.sessions[ip] = tn
            self.last_used[ip] = now
            return tn
        except (ConnectionRefusedError, ConnectionResetError) as e:
            logger.warning(f"Telnet Session Refused on {ip} (Busy/Limit?): {e}")
            return None
        except Exception as e:
            logger.error(f"Telnet Persistent Connection Error on {ip}: {e}")
            return None

telnet_session_mgr = TelnetSessionManager()

# --- Global OLT Operation Mutex & Priority Control ---
from contextlib import contextmanager

@contextmanager
def pause_monitoring():
    """Context manager to pause background polling during manual/administrative actions."""
    increment_manual_ops()
    try:
        yield
    finally:
        decrement_manual_ops()

@asynccontextmanager
async def async_pause_monitoring():
    """Async version of pause_monitoring for async endpoints."""
    increment_manual_ops()
    try:
        yield
    finally:
        decrement_manual_ops()

def _get_if_prefixes(olt_type: str):
    """Returns (olt_prefix, onu_prefix) based on OLT type.
    C3xx: gpon-olt_, gpon-onu_
    C6xx: gpon_olt-, gpon_onu-
    """
    olt_type = olt_type.lower() if olt_type else "c320"
    if "c600" in olt_type or "c620" in olt_type:
        return "gpon_olt-", "gpon_onu-"
    return "gpon-olt_", "gpon-onu_"

# ── Metrics Scheduler Logic REMOVED ─────────────────────────────────────
# (Background performance collection disabled to stabilize OLT performance)




# ── Pydantic Models ─────────────────────────────────────────────────────

class ConnectRequest(BaseModel):
    port: str
    baudrate: int = 9600
    olt_type: str = "c600"


class LoginRequest(BaseModel):
    username: str
    password: str


class StatusResponse(BaseModel):
    is_connected: bool
    port: Optional[str] = None
    baudrate: int = 9600
    olt_type: str = "c600"
    adapter_name: str = ""
    error: Optional[str] = None
    detected_ports: list[dict] = []


class PortInfoResponse(BaseModel):
    device: str
    description: str
    adapter_name: str
    vid: Optional[int] = None
    pid: Optional[int] = None


class VerifyIPRequest(BaseModel):
    ip: str
    target_olt_type: str


class RouteInfo(BaseModel):
    """A single parsed route entry from `show ip route`."""
    destination: str
    mask: str
    gateway: str
    interface: str
    owner: str


class OutBandConfig(BaseModel):
    ip: str = ""
    subnet: str = ""


class InBandConfig(BaseModel):
    enabled: bool = True
    ip: str = ""
    subnet: str = ""
    gateway: str = ""
    vlan_id: str = ""

class OLTProfile(BaseModel):
    olt_name: str
    in_band_ip: Optional[str] = None
    hostname: Optional[str] = None
    telnet_port: Optional[str] = None
    olt_type: Optional[str] = None
    enable_password: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    snmp_port: Optional[str] = "161"


class ONUDeleteItem(BaseModel):
    """A single ONU to delete from the OLT config."""
    olt_index: str   # e.g. "1/1/1"  (rack/slot/port)
    onu_id: int      # e.g. 1
    sn: str          # e.g. "ZTEGC8513C53"
    internal_id: str # frontend Map key, e.g. "c3xx-1-1-1-1"


class ONUDeleteRequest(BaseModel):
    items: List[ONUDeleteItem]


class ONURebootItem(BaseModel):
    """A single ONU to reboot physically."""
    olt_index: str   # e.g. "1/1/1"
    onu_id: int      # e.g. 77
    sn: str          # e.g. "ZTEGC8513C53"
    internal_id: str # frontend Map key


class ONURebootRequest(BaseModel):
    items: List[ONURebootItem]


class ONURegisterRequest(BaseModel):
    olt_index: str   # e.g. "1/1/1"
    sn: str          # e.g. "ZTEGC8513C53"
    onu_id: Optional[int] = None


class PingRequest(BaseModel):
    ip: str
    timeout_ms: int = 800
    port: Optional[int] = None

class PingResponse(BaseModel):
    ip: str
    is_online: bool
    latency_ms: Optional[float] = None



class ProvisioningVlanRequest(BaseModel):
    vlan_id: int
    name: Optional[str] = None
    description: Optional[str] = None

class ProvisioningVlanDeleteRequest(BaseModel):
    vlan_ids: List[int]


class ProvisioningOnuProfileRequest(BaseModel):
    profile_name: str
    vlan_id: str
    priority: str

class ProvisioningOnuProfileDeleteRequest(BaseModel):
    profile_names: List[str]

class ProvisioningTcontProfileRequest(BaseModel):
    profile_name: str
    type: int
    fbw: Optional[int] = 0
    abw: Optional[int] = 0
    mbw: Optional[int] = 0
    priority: Optional[int] = 0
    weight: Optional[int] = 0

class ProvisioningTcontProfileEditRequest(BaseModel):
    profile_name: str
    type: int
    fbw: Optional[int] = 0
    abw: Optional[int] = 0
    mbw: Optional[int] = 0

class ProvisioningTcontProfileDeleteRequest(BaseModel):
    profile_names: List[str]

class ONUProvisioningStep1Request(BaseModel):
    onu_index: str  # e.g. "1/1/3:5"
    tcont_no: int
    tcont_profile: str
    gemport_no: int
    service_port: Optional[int] = None
    vport: Optional[int] = None
    vlan_id: Union[int, str]

class ONUProvisioningStep2Request(BaseModel):
    onu_index: str
    service_name: str
    gemport_no: int
    vlan_id: Union[int, str]
    veip_name: Union[int, str]
    wan_ip_index: int
    username: str
    password: str
    vlan_profile: str
    host: int
    wan: int
    security_mgmt_num: int
    protocols: List[str]
    service_port: Optional[int] = None

class WiFiConfigItem(BaseModel):
    slot: int
    port: int
    ssid_name: str
    state: str  # lock/unlock
    auth_type: str
    passphrase: Optional[str] = None
    max_users: Optional[int] = None
    hide: bool

class ONUProvisioningStep3Request(BaseModel):
    onu_index: str
    wifi_configs: List[WiFiConfigItem]


# ── Lifespan (auto-detect loop) ────────────────────────────────────────

async def on_port_detected(port: PortInfo) -> None:
    """Callback when a new serial adapter is plugged in."""
    global latest_detected_port
    latest_detected_port = port
    logger.info(f"🔌 Adapter detected: {port.device} — {port.adapter_name}")


async def onu_power_metrics_loop():
    import datetime
    from snmp_manager import async_snmp_bulkwalk, OID, zte_rx_power_to_dbm, zte_tx_power_to_dbm, extract_oid_suffix, decode_onu_index, decode_zte_sn
    from database import SessionLocal
    from models_db import SystemSettings, OLTProfileDB, ONUPowerHistory, ConfiguredONU, UnconfiguredONU
    
    logger.info("⚡ ONU Power Metrics Loop registered. It will run immediately once, then every 10-minute mark.")
    first_run = True
    while True:
        now = datetime.datetime.now()
        
        if not first_run:
            # Calculate next 10-minute interval
            next_min = ((now.minute // 10) + 1) * 10
            if next_min >= 60:
                next_time = now.replace(minute=0, second=0, microsecond=0) + datetime.timedelta(hours=1)
            else:
                next_time = now.replace(minute=next_min, second=0, microsecond=0)
                
            wait_seconds = (next_time - now).total_seconds()
            logger.info(f"⚡ Waiting {wait_seconds:.0f} seconds until next power metrics poll...")
            await asyncio.sleep(wait_seconds + 1) # wait until the mark + 1 sec
        
        first_run = False
        
        try:
            from sync_agent import agent
            db = SessionLocal()
            
            ip = agent.active_ip
            if not ip:
                logger.debug("⚡ [POWER] No active OLT IP yet (agent.active_ip is None). Skipping poll.")
                db.close()
                continue
                
            profile = db.query(OLTProfileDB).filter(OLTProfileDB.in_band_ip == ip).first()
            if not profile:
                logger.warning(f"⚡ [POWER] OLT profile not found for IP {ip}. Skipping poll.")
                db.close()
                continue
                
            community = profile.snmp_community if profile.snmp_community else "public"
            snmp_port = profile.snmp_port if profile.snmp_port else 161
            
            logger.info(f"⚡ Running scheduled Rx/Tx SNMP Poll for {ip}")
            
            # Fetch SNMP data with delays to protect OLT CPU
            rx_data = await async_snmp_bulkwalk(ip, community, OID["onu_rx_power"], port=snmp_port, timeout=15, yield_priority=True)
            if not rx_data:
                rx_data = await async_snmp_walk(ip, community, OID["onu_rx_power"], port=snmp_port, timeout=15, yield_priority=True)
            await asyncio.sleep(1.0)
            
            tx_data = await async_snmp_bulkwalk(ip, community, OID["onu_tx_power"], port=snmp_port, timeout=15, yield_priority=True)
            if not tx_data:
                tx_data = await async_snmp_walk(ip, community, OID["onu_tx_power"], port=snmp_port, timeout=15, yield_priority=True)
            await asyncio.sleep(1.0)
            
            # Suhu ONU berpotensi timeout pada OLT lama (C3xx), kita pisahkan penanganannya
            temp_data = {}
            try:
                temp_data = await async_snmp_bulkwalk(ip, community, "1.3.6.1.4.1.3902.1082.500.20.2.2.2.1.19", port=snmp_port, timeout=15, yield_priority=True)
            except Exception as e:
                logger.warning(f"[SNMP TEMP WARN] {ip} gagal mengambil data suhu: {e}")
            
            await asyncio.sleep(1.0)
            sn_data_1 = await async_snmp_bulkwalk(ip, community, OID["onu_sn"], port=snmp_port, timeout=15, yield_priority=True)
            await asyncio.sleep(1.0)
            sn_data_2 = await async_snmp_bulkwalk(ip, community, OID["onu_sn_c6xx"], port=snmp_port, timeout=15, yield_priority=True)
            
            sn_map = {}
            for full_oid, raw_val in {**sn_data_1, **sn_data_2}.items():
                suffix = extract_oid_suffix(full_oid, OID["onu_sn"]) if full_oid.startswith(OID["onu_sn"]) else extract_oid_suffix(full_oid, OID["onu_sn_c6xx"])
                decoded = decode_onu_index(suffix)
                if decoded:
                    sn = decode_zte_sn(raw_val)
                    if sn:
                        sn_map[decoded["index_str"]] = sn
                        
            metrics = {}
            for full_oid, raw_val in rx_data.items():
                suffix = extract_oid_suffix(full_oid, OID["onu_rx_power"])
                decoded = decode_onu_index(suffix)
                if decoded:
                    idx_str = decoded["index_str"]
                    val = zte_rx_power_to_dbm(raw_val)
                    if val is not None:
                        if idx_str not in metrics: metrics[idx_str] = {}
                        metrics[idx_str]["rx"] = val
                        
            for full_oid, raw_val in tx_data.items():
                suffix = extract_oid_suffix(full_oid, OID["onu_tx_power"])
                decoded = decode_onu_index(suffix)
                if decoded:
                    idx_str = decoded["index_str"]
                    val = zte_tx_power_to_dbm(raw_val)
                    if val is not None:
                        if idx_str not in metrics: metrics[idx_str] = {}
                        metrics[idx_str]["tx"] = val

            for full_oid, raw_val in temp_data.items():
                suffix = extract_oid_suffix(full_oid, "1.3.6.1.4.1.3902.1082.500.20.2.2.2.1.19")
                decoded = decode_onu_index(suffix)
                if decoded:
                    idx_str = decoded["index_str"]
                    try:
                        if "INTEGER:" in raw_val:
                            raw_val = raw_val.split("INTEGER:")[1].strip()
                        raw_float = float(raw_val)
                        val = round(raw_float / 256.0, 2)
                        if -30.0 <= val <= 80.0:
                            if idx_str not in metrics: metrics[idx_str] = {}
                            metrics[idx_str]["temp"] = val
                    except:
                        pass
                        
            # Save to DB
            from models_db import get_gmt7_time
            now_time = get_gmt7_time()
            for idx_str, pwr in metrics.items():
                sn = sn_map.get(idx_str)
                if not sn:
                    # Fallback lookup from DB
                    onu = db.query(ConfiguredONU).filter(ConfiguredONU.pon_index == idx_str, ConfiguredONU.olt_ip == ip).first()
                    if not onu:
                        onu = db.query(UnconfiguredONU).filter(UnconfiguredONU.pon_index == idx_str, UnconfiguredONU.olt_ip == ip).first()
                    if onu:
                        sn = onu.serial_number
                        
                if sn:
                    history = ONUPowerHistory(
                        serial_number=sn,
                        olt_ip=ip,
                        rx_power=pwr.get("rx"),
                        tx_power=pwr.get("tx"),
                        temperature=pwr.get("temp"),
                        timestamp=now_time
                    )
                    db.add(history)
            
            # Clean up old data (> 30 days)
            thirty_days_ago = now_time - datetime.timedelta(days=30)
            db.query(ONUPowerHistory).filter(ONUPowerHistory.timestamp < thirty_days_ago).delete()
            db.commit()
            logger.info(f"⚡ Saved Rx/Tx for {len(metrics)} ONUs, DB cleaned.")
            
        except Exception as e:
            logger.error(f"Error in power metrics loop: {e}")
        finally:
            if 'db' in locals():
                db.close()

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start auto-detection on startup, clean up on shutdown."""
    import socket
    hostname = socket.gethostname()
    local_ips = socket.gethostbyname_ex(hostname)[2]
    logger.info(f"🚀 OLT-WEB Hardware Agent starting on all interfaces (0.0.0.0:8765)")
    for ip in local_ips:
        logger.info(f"   - Local access available at: http://{ip}:8765")
    
    await serial_mgr.start_auto_detect(on_port_detected=on_port_detected, interval=2.0)
    await agent.start()
    
    # Ensure database tables exist
    try:
        from database import engine, Base
        import models_db  # Ensure models are registered
        import time
        from sqlalchemy import text
        
        # Retry logic for database connection
        max_retries = 5
        for i in range(max_retries):
            try:
                with engine.connect() as conn:
                    conn.execute(text("SELECT 1"))
                logger.info("✅ Database connection successful.")
                break
            except Exception as e:
                if i < max_retries - 1:
                    logger.warning(f"⚠️ Database not ready yet, retrying in 2 seconds... ({i+1}/{max_retries})")
                    time.sleep(2)
                else:
                    logger.error(f"❌ Failed to connect to database after {max_retries} retries: {e}")
                    raise e
                    
        Base.metadata.create_all(bind=engine)
        logger.info("✅ Database tables verified/created.")
        
        # Seed default users if table is empty
        db_seed = SessionLocal()
        try:
            admin_exists = db_seed.query(User).filter(User.username == "admin").first()
            falcom_exists = db_seed.query(User).filter(User.username == "falcom").first()
            if not admin_exists and not falcom_exists:
                logger.info("Database is empty of users. Seeding default users...")
                default_admin = User(
                    username="falcom",
                    password_hash=get_password_hash("falcom180"),
                    role="admin",
                    full_name="Falcom Administrator"
                )
                db_seed.add(default_admin)
                
                default_guest = User(
                    username="guest",
                    password_hash=get_password_hash("guest123"),
                    role="guest",
                    full_name="Guest Viewer"
                )
                db_seed.add(default_guest)
                db_seed.commit()
                logger.info("✅ Seeded default users: falcom/falcom180 (admin) and guest/guest123 (guest).")
        except Exception as seed_err:
            logger.error(f"⚠️ Failed to seed default users: {seed_err}")
            db_seed.rollback()
        finally:
            db_seed.close()
        
        # Safe migration for new Unconfigured ONU WAN columns
        from sqlalchemy import text
        try:
            with engine.connect() as conn:
                # Get existing columns dynamically to avoid aborted transactions on PostgreSQL
                try:
                    result = conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'unconfigured_onus';"))
                    existing_cols = {row[0].lower() for row in result.fetchall()}
                except Exception:
                    existing_cols = set()

                for col, col_type in [
                    ("mode", "VARCHAR"),
                    ("wan_username", "VARCHAR"),
                    ("wan_password", "VARCHAR"),
                    ("wan_ip", "VARCHAR"),
                    ("wan_hostname", "VARCHAR"),
                    ("wan_ip_index", "INTEGER"),
                    ("hw_version", "VARCHAR"),
                ]:
                    if col not in existing_cols:
                        try:
                            conn.execute(text(f"ALTER TABLE unconfigured_onus ADD COLUMN {col} {col_type};"))
                            conn.commit()
                            logger.info(f"Added column {col} to unconfigured_onus table successfully.")
                        except Exception as add_err:
                            logger.warning(f"Failed to add column {col} (might already exist): {add_err}")
                            try:
                                conn.rollback()
                            except Exception:
                                pass
        except Exception as mig_err:
            logger.warning(f"⚠️ Safe database migration warning: {mig_err}")
    except Exception as dbe:
        logger.error(f"❌ Database initialization error: {dbe}")

    # Start ONU background discovery task (C3xx)
    # asyncio.create_task(onu_background_discovery_loop())
    logger.info("⚠️ Background discovery loop disabled by user request. System is now on-demand only.")
    
    # Start Power Metrics Monitoring Loop
    asyncio.create_task(onu_power_metrics_loop())

    yield
    await serial_mgr.stop_auto_detect()
    serial_mgr.disconnect()
    agent.stop()
    logger.info("Hardware Agent shut down.")


# ── FastAPI App ─────────────────────────────────────────────────────────
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from fastapi.responses import JSONResponse

limiter = Limiter(key_func=get_client_ip)

app = FastAPI(
    title="OLT-WEB Hardware Agent",
    version="1.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter

async def custom_rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded):
    response = JSONResponse({"detail": "Wait:60"}, status_code=429)
    try:
        response = request.app.state.limiter._inject_headers(response, request.state.view_rate_limit)
        retry_after = response.headers.get("Retry-After", "60")
        return JSONResponse({"detail": f"Wait:{retry_after}"}, status_code=429)
    except:
        return response

app.add_exception_handler(RateLimitExceeded, custom_rate_limit_exceeded_handler)

# CORS — allow specific origins for credential support (cookies)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:5173",  # Vite default
        "http://127.0.0.1:5173",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ],
    allow_origin_regex=r"http://192\.168\.180\..*:[0-9]+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/system/reset-telnet")
def api_reset_telnet():
    """Manual trigger to clear all hung telnet sessions."""
    telnet_session_mgr.reset_all()
    return {"status": "success", "message": "All Telnet sessions cleared."}


# ── Authentication Endpoints ───────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str

class ChangeAccountRequest(BaseModel):
    current_password: str
    new_username: Optional[str] = None
    new_password: Optional[str] = None

import time
import re

def validate_password_complexity(password: str):
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if not re.search(r"[A-Z]", password):
        raise HTTPException(status_code=400, detail="Password must contain at least one uppercase letter")
    if not re.search(r"[a-z]", password):
        raise HTTPException(status_code=400, detail="Password must contain at least one lowercase letter")
    if not re.search(r"\d", password):
        raise HTTPException(status_code=400, detail="Password must contain at least one digit")

@app.post("/api/auth/login")
@limiter.limit("5/minute")
async def login(req: LoginRequest, response: Response, request: Request, db: Session = Depends(get_db)):
    client_ip = get_client_ip(request)

    user = db.query(User).filter(User.username == req.username).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    token = create_session_token(user.username, user.role, db)
    
    update_activity()
    
    # Initialize Persistent IP-Lock (Legacy logic maintained for tracking, but auth bypass removed earlier)
    _set_db_setting(db, "last_admin_ip", client_ip)
    
    # Set secure cookie
    response.set_cookie(
        key="olt_session",
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=86400 # 24 hours
    )
    
    return {
        "status": "success",
        "user": {
            "username": user.username,
            "role": user.role,
            "full_name": user.full_name
        }
    }

@app.post("/api/auth/logout")
async def logout(response: Response, db: Session = Depends(get_db)):
    _set_db_setting(db, "last_admin_ip", "")
    response.delete_cookie("olt_session")
    return {"status": "success"}

@app.get("/api/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    return current_user

@app.post("/api/auth/change-account")
async def change_account(req: ChangeAccountRequest, response: Response, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    user = db.query(User).filter(User.username == current_user["username"]).first()
    if not user or not verify_password(req.current_password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect current password")
    
    if req.new_username:
        # Check if username already exists
        existing = db.query(User).filter(User.username == req.new_username).first()
        if existing and existing.id != user.id:
            raise HTTPException(status_code=400, detail="Username already taken")
        user.username = req.new_username
        
    if req.new_password:
        user.password_hash = get_password_hash(req.new_password)
    
    db.commit()
    
    # Refresh the session cookie with new username/token
    token = create_session_token(user.username, user.role, db)
    response.set_cookie(
        key="olt_session",
        value=token,
        httponly=True,
        max_age=86400,
        samesite="lax",
        secure=False
    )
    
    return {"status": "success", "message": "Account updated successfully", "username": user.username}

class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: str = "guest"
    full_name: Optional[str] = None

@app.get("/api/auth/users")
async def get_users(db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    # Any logged in user can view the list (can restrict to admin if strict)
    users = db.query(User).all()
    return {
        "status": "success",
        "users": [{"id": u.id, "username": u.username, "role": u.role, "full_name": u.full_name, "created_at": u.created_at} for u in users]
    }

@app.post("/api/auth/users")
async def create_user(req: CreateUserRequest, db: Session = Depends(get_db), current_user: dict = Depends(admin_required)):
    # Check if username exists
    existing = db.query(User).filter(User.username == req.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    if req.role not in ["admin", "guest"]:
        raise HTTPException(status_code=400, detail="Role must be 'admin' or 'guest'")
    
    validate_password_complexity(req.password)
    
    new_user = User(
        username=req.username,
        password_hash=get_password_hash(req.password),
        role=req.role,
        full_name=req.full_name
    )
    db.add(new_user)
    db.commit()
    
    return {"status": "success", "message": f"User {req.username} created successfully"}

@app.delete("/api/auth/users/{user_id}")
async def delete_user(user_id: int, db: Session = Depends(get_db), current_user: dict = Depends(admin_required)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    if user.username == current_user["username"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
        
    db.delete(user)
    db.commit()
    return {"status": "success", "message": f"User deleted successfully"}

class ResetPasswordRequest(BaseModel):
    new_password: str

@app.post("/api/auth/users/{user_id}/reset-password")
async def reset_user_password(user_id: int, req: ResetPasswordRequest, db: Session = Depends(get_db), current_user: dict = Depends(admin_required)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    validate_password_complexity(req.new_password)
        
    user.password_hash = get_password_hash(req.new_password)
    user.session_version = (user.session_version or 1) + 1  # Increment version to revoke old tokens
    db.commit()
    return {"status": "success", "message": f"Password for {user.username} has been reset successfully"}

# ── REST Endpoints ──────────────────────────────────────────────────────

@app.get("/api/profile", response_model=OLTProfile)
@app.get("/api/profile/olt-config", response_model=OLTProfile)
def get_olt_profile(olt_type: Optional[str] = None, db: Session = Depends(get_db)):
    """Fetch OLT config profile based on olt_type or currently selected OLT."""
    from fastapi import HTTPException
    if db is None:
        raise HTTPException(status_code=503, detail="Database not available")
    
    try:
        # 1. Prioritize olt_type parameter if provided
        target_type = olt_type
        
        # 2. If not provided, fetch the currently selected OLT ID from settings
        if not target_type:
            target_type = get_selected_olt_id(db)
        
        if not target_type:
            # Last fallback
            setting = db.query(SystemSettings).filter(SystemSettings.key == "current_active_olt_ip").first()
            if setting and setting.value:
                config = db.query(OLTProfileDB).filter(OLTProfileDB.in_band_ip == setting.value).first()
                if config:
                    target_type = config.olt_type

        if not target_type:
            raise HTTPException(status_code=404, detail="No OLT type specified or selected")

        config = db.query(OLTProfileDB).filter(OLTProfileDB.olt_type == target_type).first()
        
        if not config:
            # Return a blank profile for the type so the frontend can fill it
            return OLTProfile(
                olt_name="New OLT",
                olt_type=target_type,
                in_band_ip="",
                telnet_port="23",
                hostname="ZXAN"
            )
        
        # Decrypt passwords before returning to frontend
        decrypted_pwd = decrypt_password(config.password, db)
        decrypted_enable = decrypt_password(config.enable_password, db)
        
        return OLTProfile(
            olt_name=config.olt_name or "Registered OLT",
            in_band_ip=config.in_band_ip or "",
            olt_type=config.olt_type,
            hostname=config.hostname or "ZXAN",
            telnet_port=str(config.telnet_port) if config.telnet_port else "23",
            enable_password=decrypted_enable,
            username=config.username,
            password=decrypted_pwd
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_olt_profile: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {e}")


@app.post("/api/profile/verify-ip")
async def verify_olt_ip(req: VerifyIPRequest, db: Session = Depends(get_db)):
    """Connects to a new IP to verify if it matches the target OLT type, then saves it if valid."""
    from fastapi import HTTPException
    from sync_agent import agent
    from network_manager import network_mgr
    from security_utils import decrypt_password

    # 1. Get profile credentials to attempt login at the NEW IP
    profile = db.query(OLTProfileDB).filter(OLTProfileDB.olt_type == req.target_olt_type).first()
    if not profile:
        # If no profile exists yet, we use defaults to probe
        username = "admin"
        password = "zte"
        enable_pwd = "zxr10"
        telnet_port = 23
    else:
        username = profile.username or "admin"
        password = decrypt_password(profile.password, db) if profile.password else "zte"
        enable_pwd = decrypt_password(profile.enable_password, db) if profile.enable_password else "zxr10"
        telnet_port = profile.telnet_port or 23

    # 2. Perform Handshake
    logger.info(f"[VERIFY] Probing {req.ip} for {req.target_olt_type}...")
    
    # Check ping first (non-blocking — some OLTs block ICMP)
    is_reachable = await network_mgr.check_ping(req.ip, port=telnet_port)
    if not is_reachable:
        logger.warning(f"[VERIFY] Ping failed for {req.ip}, attempting Telnet fallback...")

    connected = await network_mgr.connect(
        req.ip, telnet_port, username, password, enable_pwd, timeout=5.0
    )
    
    if not connected:
        raise HTTPException(status_code=400, detail="Could not establish Telnet connection with provided credentials")

    try:
        # Check identity
        version_info = await network_mgr.execute_command("show version-running")
        card_info = await network_mgr.execute_command("show card")
        handshake_blob = (version_info + card_info).upper()
        
        # Get keywords for target type
        target_keywords = agent.type_keywords.get(req.target_olt_type.lower(), [])
        is_match = any(kw.upper() in handshake_blob for kw in target_keywords)

        if not is_match:
            # Try to identify what it actually is
            detected = "Unknown"
            for t_id, kws in agent.type_keywords.items():
                if any(kw.upper() in handshake_blob for kw in kws):
                    detected = t_id.upper()
                    break
            await network_mgr.disconnect()
            raise HTTPException(status_code=400, detail=f"Identity Mismatch: Hardware at {req.ip} responds as {detected}, not {req.target_olt_type.upper()}")

        # 3. SUCCESS - Save IP to Database
        if profile:
            profile.in_band_ip = req.ip
        else:
            new_profile = OLTProfileDB(
                olt_type=req.target_olt_type,
                in_band_ip=req.ip,
                olt_name=f"Registered {req.target_olt_type.upper()}",
                telnet_port=telnet_port,
                username=username,
                # We save defaults if creating new
                password=encrypt_password(password, db),
                enable_password=encrypt_password(enable_pwd, db)
            )
            db.add(new_profile)
        
        db.commit()
        logger.info(f"[VERIFY SUCCESS] Saved {req.ip} for {req.target_olt_type}")
        
        # 4. Trigger immediate sync
        agent.trigger_sync()
        await network_mgr.disconnect()
        
        return {"status": "success", "message": f"Successfully verified and saved IP for {req.target_olt_type.upper()}"}

    except HTTPException:
        raise
    except Exception as e:
        await network_mgr.disconnect()
        logger.error(f"[VERIFY ERROR] {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/profile/olt-config", response_model=OLTProfile)
async def save_olt_profile(profile: OLTProfile, db: Session = Depends(get_db), current_user = Depends(admin_required)):
    """Upsert OLT config profile to database using OLT type as key."""
    from fastapi import HTTPException
    if db is None:
        raise HTTPException(status_code=500, detail="Database is not reachable")

    if not profile.olt_type:
        raise HTTPException(status_code=400, detail="OLT type is required for profile persistence")

    # ----- NEW VERIFICATION BLOCK -----
    if profile.in_band_ip:
        from network_manager import network_mgr
        from sync_agent import agent
        telnet_port = int(profile.telnet_port) if profile.telnet_port else 23
        
        connected = await network_mgr.connect(
            profile.in_band_ip, telnet_port, profile.username, profile.password, profile.enable_password, timeout=5.0
        )
        if not connected:
            raise HTTPException(status_code=400, detail="Could not establish Telnet connection with provided credentials")
            
        try:
            card_info = await network_mgr.execute_command("show card")
            handshake_blob = card_info.upper()
            
            target_keywords = agent.type_keywords.get(profile.olt_type.lower(), [])
            is_match = any(kw.upper() in handshake_blob for kw in target_keywords)
            
            if not is_match:
                detected = "Unknown"
                for t_id, kws in agent.type_keywords.items():
                    if any(kw.upper() in handshake_blob for kw in kws):
                        detected = t_id.upper()
                        break
                await network_mgr.disconnect()
                raise HTTPException(status_code=400, detail=f"Identity Mismatch: Hardware at {profile.in_band_ip} responds as {detected}, not {profile.olt_type.upper()}")
                
            await network_mgr.disconnect()
        except HTTPException:
            raise
        except Exception as e:
            await network_mgr.disconnect()
            raise HTTPException(status_code=400, detail=f"Identity Verification Failed: {e}")
    # ----- END VERIFICATION BLOCK -----

    # Update global settings
    setting = db.query(SystemSettings).filter(SystemSettings.key == "selected_olt_id").first()
    if setting:
        setting.value = profile.olt_type
    else:
        db.add(SystemSettings(key="selected_olt_id", value=profile.olt_type))

    # Encrypt sensitive fields
    encrypted_pwd = encrypt_password(profile.password, db)
    encrypted_enable = encrypt_password(profile.enable_password, db)

    # Upsert profile by olt_type
    config = db.query(OLTProfileDB).filter(OLTProfileDB.olt_type == profile.olt_type).first()

    if config:
        config.in_band_ip = profile.in_band_ip
        config.olt_name = profile.olt_name
        config.hostname = profile.hostname
        config.telnet_port = int(profile.telnet_port) if profile.telnet_port else None
        config.enable_password = encrypted_enable
        config.username = profile.username
        config.password = encrypted_pwd
        config.snmp_port = int(profile.snmp_port) if profile.snmp_port else 161
    else:
        config = OLTProfileDB(
            olt_type=profile.olt_type,
            in_band_ip=profile.in_band_ip,
            olt_name=profile.olt_name,
            hostname=profile.hostname,
            telnet_port=int(profile.telnet_port) if profile.telnet_port else None,
            enable_password=encrypted_enable,
            username=profile.username,
            password=encrypted_pwd,
            snmp_port=int(profile.snmp_port) if profile.snmp_port else 161
        )
        db.add(config)
    
    try:
        db.commit()
        db.refresh(config)
        # Trigger agent to re-sync with new credentials
        agent.trigger_sync()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    
    return OLTProfile(
        olt_name=config.olt_name or "Registered OLT",
        in_band_ip=config.in_band_ip,
        olt_type=config.olt_type,
        hostname=config.hostname,
        telnet_port=str(config.telnet_port) if config.telnet_port else "23",
        enable_password=profile.enable_password, # Return plain for immediate feedback
        username=config.username,
        password=profile.password,
        snmp_port=str(config.snmp_port) if config.snmp_port else "161"
    )




class SwitchTargetRequest(BaseModel):
    olt_id: str


@app.post("/api/agent/switch-target")
async def switch_agent_target(req: SwitchTargetRequest, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Update user's selected OLT ID and force the sync agent to re-verify immediately (Master Kill Switch)."""
    if db is None:
        raise HTTPException(status_code=500, detail="Database not available")
        
    try:
        setting = db.query(SystemSettings).filter(SystemSettings.key == "selected_olt_id").first()
        if setting:
            setting.value = req.olt_id
        else:
            db.add(SystemSettings(key="selected_olt_id", value=req.olt_id))
        
        db.commit()
        
        # MASTER KILL SWITCH: Set agent to LOADING state and broadcast immediately
        agent.current_state = "LOADING"
        agent.verified_olt_id = req.olt_id
        agent.active_ip = None
        
        # Clear vitals cache to ensure fresh metrics are fetched immediately after loading completes
        vitals_cache.clear()
        vitals_cache_time.clear()
        
        await agent.broadcast_state()
        
        # Trigger immediate re-sync loop
        agent.trigger_sync()
        
        return {"status": "success", "olt_id": req.olt_id}
    except Exception as e:
        db.rollback()
        logger.error(f"Error in switch_agent_target: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class ProbeDiscoveryRequest(BaseModel):
    in_band_ip: str

@app.post("/api/profile/probe-discovery")
async def probe_discovery(req: ProbeDiscoveryRequest):
    """Trigger hardware discovery via serial and return OLT configuration."""
    from fastapi import HTTPException
    if not serial_mgr.state.is_connected:
        raise HTTPException(status_code=503, detail="Serial port not connected")
    
    # Run probing in a thread to avoid blocking the event loop
    try:
        results = await serial_mgr.probe_olt_discovery()
        if results.get("error"):
            raise HTTPException(status_code=500, detail=results["error"])
        
        # Format for frontend
        return {
            "hostname": results.get("hostname"),
            "telnet_port": str(results.get("telnet_port")) if results.get("telnet_port") else None,
            "username": results["usernames"][0] if results.get("usernames") else None,
            # We don't return passwords from probe unless specifically requested
            # but usually we leave them empty for manual verification as per requirements.
            "enable_password": "", 
            "password": ""
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Probe Discovery Endpoint Error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))

@app.post("/api/network/ping", response_model=PingResponse)
async def ping_ip(req: PingRequest, db: Session = Depends(get_db)):
    """Echo ping to check OLT reachability with TCP fallback."""
    port = req.port or 23
    if not req.port:
        try:
            profile = db.query(OLTProfileDB).filter(OLTProfileDB.in_band_ip == req.ip).first()
            if profile and profile.telnet_port:
                port = profile.telnet_port
        except Exception:
            pass
    is_online = await network_mgr.check_ping(req.ip, timeout_ms=req.timeout_ms, port=port)
    return PingResponse(ip=req.ip, is_online=is_online)


@app.get("/api/status", response_model=StatusResponse)
async def get_status():
    """Return current connection state and detected ports."""
    state = serial_mgr.state
    ports = serial_mgr.detected_ports
    return StatusResponse(
        is_connected=state.is_connected,
        port=state.port,
        baudrate=state.baudrate,
        olt_type=state.olt_type,
        adapter_name=state.adapter_name,
        error=state.error,
        detected_ports=[
            {
                "device": p.device,
                "description": p.description,
                "adapter_name": p.adapter_name,
                "vid": p.vid,
                "pid": p.pid,
            }
            for p in ports
        ],
    )


@app.get("/api/ports", response_model=list[PortInfoResponse])
async def scan_ports():
    """Force a fresh scan and return all detected serial ports."""
    ports = await asyncio.get_event_loop().run_in_executor(None, serial_mgr.scan_ports)
    return [
        PortInfoResponse(
            device=p.device,
            description=p.description,
            adapter_name=p.adapter_name,
            vid=p.vid,
            pid=p.pid,
        )
        for p in ports
    ]


# ── Helper: run a blocking CLI command and capture output ────────────────

async def _run_serial_command(
    command: bytes,
    prompt_ends: tuple[str, ...] = ("#",),
    timeout: float = 6.0,
) -> str:
    """
    Write `command` to the serial port, then collect bytes until a line
    ending with one of the `prompt_ends` arrives (or `timeout` seconds elapse).
    """
    if not serial_mgr._serial or not serial_mgr._serial.is_open:
        raise RuntimeError("Serial port not connected")

    try:
        loop = asyncio.get_event_loop()
        # Only reset input to avoid getting leftover data from previous commands
        await loop.run_in_executor(None, serial_mgr._serial.reset_input_buffer)
        
        # Write the actual command
        await loop.run_in_executor(None, serial_mgr._serial.write, command)

        collected = b""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            chunk = await loop.run_in_executor(None, serial_mgr._blocking_read)
            if chunk:
                collected += chunk
                text = collected.decode("utf-8", errors="replace")
                lines = [l for l in text.splitlines() if l.strip()]
                if lines:
                    last_line = lines[-1].strip()
                    # Check if the last line ends with the expected prompt
                    if any(last_line.endswith(p) for p in prompt_ends):
                        # Ensure we didn't just catch the echo of our own command
                        # (ZTE OLTs sometimes echo the command before results)
                        if len(lines) > 1 or not last_line.startswith(command.decode().strip()):
                            return text
            else:
                await asyncio.sleep(0.05)

        return collected.decode("utf-8", errors="replace")
    except (OSError, Exception) as e:
        logger.error(f"Serial command execution failed: {e}")
        raise RuntimeError(f"Hardware communication error: {str(e)}")


def _parse_ip_routes(raw: str) -> list[dict]:
    """Parse `show ip route` output into a list of dicts."""
    results: list[dict] = []
    # Regex to match: Dest Mask Gw Interface Owner
    # Example: 0.0.0.0 0.0.0.0 10.10.10.1 vlan100 static
    pattern = re.compile(
        r'^\s*(?P<dest>[\d.]+)'          # Destination
        r'\s+(?P<mask>[\d.]+)'          # Mask
        r'\s+(?P<gw>[\d.]+)'            # Gateway
        r'\s+(?P<iface>\S+)'            # Interface
        r'\s+(?P<owner>\S+)'            # Owner (static, direct, etc)
        r'.*$',
        re.IGNORECASE,
    )
    
    for line in raw.splitlines():
        line = line.strip()
        if not line or "Dest" in line or "IPv4" in line or "---" in line:
            continue
        
        m = pattern.search(line)
        if m:
            results.append({
                "destination": m.group("dest"),
                "mask": m.group("mask"),
                "gateway": m.group("gw"),
                "interface": m.group("iface"),
                "owner": m.group("owner")
            })
    return results


def _parse_ip_interfaces(raw: str) -> list[dict]:
    """Parse `show ip interface brief` output into a list of dicts."""
    results: list[dict] = []
    pattern = re.compile(
        r'^\s*(?P<iface>\S+)'
        r'\s+(?P<ip>[\d.]+|unassigned)'
        r'\s+(?P<mask>[\d.]+|unassigned|--)'
        r'\s+(?P<admin>\S+)'
        r'\s+(?P<phy>\S+)'
        r'\s+(?P<prot>\S+)'
        r'.*$',
        re.IGNORECASE,
    )
    skip_words = {"interface", "---"}
    for line in raw.splitlines():
        if not line.strip() or line.strip() == "---": continue
        m = pattern.search(line)
        if not m:
            continue
        iface = m.group("iface")
        if iface.lower() in skip_words or iface.startswith("%") or "#" in iface:
            continue
        ip = m.group("ip")
        mask = m.group("mask")
        status = m.group("phy").lower() # Physical status
        vlan_id: Optional[str] = None
        if iface.lower().startswith("vlan"):
            vlan_id = re.sub(r"[^0-9]", "", iface) or None
        results.append({
            "interface": iface,
            "ip": ip,
            "mask": mask,
            "status": status,
            "vlan_id": vlan_id
        })
    return results


@app.get("/api/console/inspect-ip", response_model=list[RouteInfo])
async def inspect_ip():
    """Send `show ip route`, parse, and return structured routing table."""
    from fastapi import HTTPException
    if not serial_mgr.state.is_connected:
        raise HTTPException(status_code=503, detail="Serial port not connected")
    try:
        # Probe current prompt mode
        probe = await _run_serial_command(b"\r", prompt_ends=(">", "#"), timeout=1.5)
        if ">" in probe and "#" not in probe:
            logger.info("inspect-ip: entering enable mode")
            enable_out = await _run_serial_command(b"enable\r", prompt_ends=("#", "Password:"), timeout=3.0)
            if "Password:" in enable_out:
                logger.info("inspect-ip: sending default enable password")
                await _run_serial_command(b"zxr10\r", prompt_ends=("#",), timeout=3.0)

        raw = await _run_serial_command(b"show ip route\r", prompt_ends=("#",), timeout=7.0)
        logger.info(f"inspect-ip (route) raw length: {len(raw)}")

        if raw.strip().endswith(">"):
            raise HTTPException(status_code=422, detail="OLT is not in privileged mode (#). Enable mode failed.")
            
        return _parse_ip_routes(raw)
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        logger.error(f"inspect-ip error: {exc}")
        raise HTTPException(status_code=503, detail="OLT communication failed")


@app.get("/api/console/out-band", response_model=OutBandConfig)
async def get_out_band_config():
    """Send command to check eth-mgmt1 IP and return as JSON."""
    from fastapi import HTTPException
    if not serial_mgr.state.is_connected:
        raise HTTPException(status_code=503, detail="Serial port not connected")
    try:
        probe = await _run_serial_command(b"\r", prompt_ends=(">", "#"), timeout=1.5)
        if ">" in probe and "#" not in probe:
            enable_out = await _run_serial_command(b"enable\r", prompt_ends=("#", "Password:"), timeout=3.0)
            if "Password:" in enable_out:
                await _run_serial_command(b"zxr10\r", prompt_ends=("#",), timeout=3.0)

        # Determine interface name based on OLT type
        olt_type = serial_mgr.state.olt_type.lower() if serial_mgr.state.olt_type else ""
        olt_type_lower = olt_type.lower() if olt_type else ""
        iface_name = "eth-mgmt1" if ("c600" in olt_type_lower or "c620" in olt_type_lower) else "mng1"
        
        logger.info(f"get_out_band_config: detected olt_type={olt_type}, using iface={iface_name}")

        # Try `show running-config interface ...` as it cleanly shows ip address
        raw = await _run_serial_command(f"show running-config interface {iface_name}\r".encode(), prompt_ends=("#",), timeout=5.0)
        
        # Fallback to general `show interface` if invalid
        if "Invalid" in raw or "Error" in raw:
            raw = await _run_serial_command(f"show interface {iface_name}\r".encode(), prompt_ends=("#",), timeout=5.0)

        m = re.search(r'ip address\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)', raw, re.IGNORECASE)
        if m:
            return OutBandConfig(ip=m.group(1), subnet=m.group(2))
        return OutBandConfig(ip="", subnet="")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/console/out-band")
async def save_out_band_config(config: OutBandConfig):
    """Save explicit IP/subnet to eth-mgmt1 interface in config mode."""
    from fastapi import HTTPException
    if not serial_mgr.state.is_connected:
        raise HTTPException(status_code=503, detail="Serial port not connected")
    try:
        probe = await _run_serial_command(b"\r", prompt_ends=(">", "#"), timeout=1.5)
        if ">" in probe and "#" not in probe:
            enable_out = await _run_serial_command(b"enable\r", prompt_ends=("#", "Password:"), timeout=3.0)
            if "Password:" in enable_out:
                await _run_serial_command(b"zxr10\r", prompt_ends=("#",), timeout=3.0)

        # Determine interface name based on OLT type
        olt_type = serial_mgr.state.olt_type.lower() if serial_mgr.state.olt_type else ""
        olt_type_lower = olt_type.lower() if olt_type else ""
        iface_name = "eth-mgmt1" if ("c600" in olt_type_lower or "c620" in olt_type_lower) else "mng1"

        await _run_serial_command(b"configure terminal\r", prompt_ends=("#",), timeout=3.0)
        await _run_serial_command(f"interface {iface_name}\r".encode(), prompt_ends=("#",), timeout=3.0)
        
        ip_cmd = f"ip address {config.ip} {config.subnet}\r".encode("utf-8")
        raw = await _run_serial_command(ip_cmd, prompt_ends=("#",), timeout=3.0)
        
        if "Error" in raw or "Invalid" in raw:
            await _run_serial_command(b"exit\r", prompt_ends=("#",), timeout=1.0)
            await _run_serial_command(b"exit\r", prompt_ends=("#",), timeout=1.0)
            raise HTTPException(status_code=422, detail=f"OLT rejected ip setup: {raw[:150]}")

        await _run_serial_command(b"exit\r", prompt_ends=("#",), timeout=2.0)
        await _run_serial_command(b"exit\r", prompt_ends=("#",), timeout=2.0)
        
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/console/in-band", response_model=InBandConfig)
async def get_in_band_config():
    """Find the vlan interface and its default gateway."""
    from fastapi import HTTPException
    if not serial_mgr.state.is_connected:
        raise HTTPException(status_code=503, detail="Serial port not connected")
    try:
        probe = await _run_serial_command(b"\r", prompt_ends=(">", "#"), timeout=1.5)
        if ">" in probe and "#" not in probe:
            enable_out = await _run_serial_command(b"enable\r", prompt_ends=("#", "Password:"), timeout=3.0)
            if "Password:" in enable_out:
                await _run_serial_command(b"zxr10\r", prompt_ends=("#",), timeout=3.0)

        # Parse VLAN IP
        raw_ip = await _run_serial_command(b"show ip interface brief\r", prompt_ends=("#",), timeout=7.0)
        interfaces = _parse_ip_interfaces(raw_ip)
        
        vlan_iface = None
        for ifc in interfaces:
            if ifc["interface"].lower().startswith("vlan") and ifc["ip"] != "unassigned":
                vlan_iface = ifc
                break

        if not vlan_iface:
            return InBandConfig(enabled=True, ip="", subnet="", gateway="", vlan_id="")

        # Query gateway
        raw_route = await _run_serial_command(b"show ip route\r", prompt_ends=("#",), timeout=5.0)
        gateway = ""
        rm = re.search(r'0\.0\.0\.0\s+(?:0\.0\.0\.0|/0)\s+(\d+\.\d+\.\d+\.\d+)', raw_route)
        if rm:
            gateway = rm.group(1)

        return InBandConfig(
            enabled=True,
            ip=vlan_iface["ip"],
            subnet=vlan_iface["mask"] if vlan_iface.get("mask") else "",
            gateway=gateway,
            vlan_id=vlan_iface.get("vlan_id") or ""
        )

    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        logger.error(f"in-band get error: {exc}")
        raise HTTPException(status_code=503, detail="OLT communication failed")


@app.post("/api/console/in-band")
async def save_in_band_config(config: InBandConfig, db: Session = Depends(get_db)):
    """Save in-band IP details and bind to currently selected OLT type."""
    from fastapi import HTTPException
    if not serial_mgr.state.is_connected:
        raise HTTPException(status_code=503, detail="Serial port not connected")
    try:
        # 1. Apply to hardware
        probe = await _run_serial_command(b"\r", prompt_ends=(">", "#"), timeout=1.5)
        if ">" in probe and "#" not in probe:
            enable_out = await _run_serial_command(b"enable\r", prompt_ends=("#", "Password:"), timeout=3.0)
            if "Password:" in enable_out:
                await _run_serial_command(b"zxr10\r", prompt_ends=("#",), timeout=3.0)

        if not config.vlan_id:
            raise HTTPException(status_code=422, detail="VLAN ID is required")

        await _run_serial_command(b"configure terminal\r", prompt_ends=("#",), timeout=3.0)
        
        # Create VLAN just in case
        await _run_serial_command(f"vlan {config.vlan_id}\r".encode(), prompt_ends=("#",), timeout=3.0)
        await _run_serial_command(b"exit\r", prompt_ends=("#",), timeout=2.0)
        
        # Interface VLAN
        await _run_serial_command(f"interface vlan{config.vlan_id}\r".encode(), prompt_ends=("#",), timeout=3.0)
        ip_cmd = f"ip address {config.ip} {config.subnet}\r".encode()
        await _run_serial_command(ip_cmd, prompt_ends=("#",), timeout=3.0)
        await _run_serial_command(b"exit\r", prompt_ends=("#",), timeout=2.0)

        # Gateway (default route)
        if config.gateway:
            gw_cmd = f"ip route 0.0.0.0 0.0.0.0 {config.gateway}\r".encode()
            await _run_serial_command(gw_cmd, prompt_ends=("#",), timeout=3.0)

        await _run_serial_command(b"exit\r", prompt_ends=("#",), timeout=2.0)
        
        # 2. Persist to DB Profile (Absolute Persistence)
        if db is not None:
            # Get selected OLT type
            target_type = get_selected_olt_id(db) or serial_mgr.state.olt_type
            
            if target_type:
                profile = db.query(OLTProfileDB).filter(OLTProfileDB.olt_type == target_type).first()
                if profile:
                    profile.in_band_ip = config.ip
                else:
                    profile = OLTProfileDB(
                        olt_type=target_type,
                        in_band_ip=config.ip,
                        olt_name=f"ZTE {target_type.upper()}",
                        telnet_port=23
                    )
                    db.add(profile)
                
                # Also update current active IP setting
                ip_setting = db.query(SystemSettings).filter(SystemSettings.key == "current_active_olt_ip").first()
                if not ip_setting:
                    db.add(SystemSettings(key="current_active_olt_ip", value=config.ip))
                else:
                    ip_setting.value = config.ip
                
                db.commit()
                # Trigger agent sync
                agent.trigger_sync()

        return {"status": "success"}
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        logger.error(f"Error saving in-band config: {exc}")
        raise HTTPException(status_code=503, detail="OLT communication failed")


@app.post("/api/connect", response_model=StatusResponse)
async def connect(req: ConnectRequest):
    """Open a serial connection and verify that the hardware matches the selected OLT type."""
    state = await asyncio.get_event_loop().run_in_executor(
        None, serial_mgr.connect, req.port, req.baudrate, req.olt_type
    )

    if not state.is_connected:
        # Port open failed — return the error immediately
        return StatusResponse(
            is_connected=False,
            port=state.port,
            baudrate=state.baudrate,
            olt_type=state.olt_type,
            adapter_name=state.adapter_name,
            error=state.error,
        )

    # ── Hardware verification ──────────────────────────────────────────────
    # Silently run `show version` to confirm what OLT is actually connected.
    detected_olt = await serial_mgr.verify_olt_type(req.olt_type)

    olt_names = {"c600": "ZTE C600", "c300": "ZTE C300", "c320": "ZTE C320"}

    if detected_olt is None:
        # Hardware not recognised — disconnect and tell the wizard to go back
        serial_mgr.disconnect()
        return StatusResponse(
            is_connected=False,
            port=req.port,
            baudrate=req.baudrate,
            olt_type=req.olt_type,
            error=(
                "Hardware not recognised. The connected device did not respond to "
                "'show version' with a known OLT model identifier. "
                "Please check the cable or select the correct OLT type."
            ),
        )

    if detected_olt != req.olt_type:
        # Mismatch — disconnect and report which model was actually detected
        detected_name = olt_names.get(detected_olt, detected_olt.upper())
        expected_name = olt_names.get(req.olt_type, req.olt_type.upper())
        serial_mgr.disconnect()
        return StatusResponse(
            is_connected=False,
            port=req.port,
            baudrate=req.baudrate,
            olt_type=req.olt_type,
            error=(
                f"OLT type mismatch! You selected {expected_name} but the hardware "
                f"identified itself as {detected_name}. "
                f"Please go back and choose {detected_name}."
            ),
        )

    # Hardware matches — return success
    ports = serial_mgr.detected_ports
    return StatusResponse(
        is_connected=state.is_connected,
        port=state.port,
        baudrate=state.baudrate,
        olt_type=state.olt_type,
        adapter_name=state.adapter_name,
        error=state.error,
        detected_ports=[
            {
                "device": p.device,
                "description": p.description,
                "adapter_name": p.adapter_name,
            }
            for p in ports
        ],
    )


@app.post("/api/disconnect", response_model=StatusResponse)
async def disconnect():
    """Close the current serial connection."""
    state = serial_mgr.disconnect()
    return StatusResponse(
        is_connected=state.is_connected,
        port=state.port,
        baudrate=state.baudrate,
        olt_type=state.olt_type,
        error=state.error,
    )


# ── WebSocket Terminal Endpoint ─────────────────────────────────────────

@app.websocket("/ws/terminal")
async def websocket_terminal(ws: WebSocket):
    """
    Bidirectional terminal bridge — supports multiple simultaneous tabs.

    Messages FROM the browser:
      - JSON: {"type": "input", "data": "<base64 or raw string>"}
      - JSON: {"type": "resize", "cols": N, "rows": N}  (future use)

    Messages TO the browser:
      - JSON: {"type": "output", "data": "<raw string>"}
      - JSON: {"type": "disconnect"}
      - JSON: {"type": "error", "message": "..."}
    """
    await ws.accept()
    async with active_ws_clients_lock:
        active_ws_clients.add(ws)
    agent.terminal_active_count += 1
    logger.info(f"WebSocket terminal client connected. Active terminals: {agent.terminal_active_count}")

    if not serial_mgr.state.is_connected:
        await ws.send_json({"type": "error", "message": "Serial port not connected. Use the Connection Wizard first."})
        # Keep alive so the frontend can retry after connecting

    # State to suppress output during reset (per-client)
    ws_state = {"suppress_output": False}

    import re
    async def on_serial_data(data: bytes) -> None:
        """Forward serial output → this specific WebSocket client."""
        if ws_state["suppress_output"]:
            return
        try:
            text = data.decode("utf-8", errors="replace")
            text = text.replace("ZXAN>", "ZXAN#")
            text = re.sub(r'\n+', '\n', text)
            await ws.send_json({"type": "output", "data": text})
        except Exception as exc:
            logger.warning(f"WS send error (client may have closed): {exc}")

    async def on_serial_disconnect() -> None:
        """Notify this browser tab that serial was lost."""
        try:
            await ws.send_json({"type": "disconnect"})
        except Exception:
            pass

    # Register this client's callbacks with the serial manager
    if serial_mgr.state.is_connected:
        ws_state["suppress_output"] = False
        await serial_mgr.start_read_loop(
            on_data=on_serial_data,
            on_disconnect=on_serial_disconnect,
        )

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                msg = {"type": "input", "data": raw}

            msg_type = msg.get("type", "input")

            if msg_type == "input":
                data_str: str = msg.get("data", "")
                if serial_mgr.state.is_connected:
                    await serial_mgr.write(data_str.encode("utf-8", errors="replace"))
                else:
                    await ws.send_json({
                        "type": "error",
                        "message": "Not connected to serial port.",
                    })

            elif msg_type == "start_read":
                pass

            elif msg_type == "ping":
                await ws.send_json({"type": "pong"})

    except WebSocketDisconnect:
        logger.info("WebSocket terminal client disconnected")
    except Exception as exc:
        logger.error(f"WebSocket error: {exc}")
    finally:
        # Unregister this client's callbacks — other tabs remain unaffected
        await serial_mgr.stop_read_loop(
            on_data=on_serial_data,
            on_disconnect=on_serial_disconnect,
        )
        async with active_ws_clients_lock:
            active_ws_clients.discard(ws)
        agent.terminal_active_count = max(0, agent.terminal_active_count - 1)
        logger.info(f"Terminal WS disconnected. Active terminals: {agent.terminal_active_count}")

# -- Global State WS ──────────────────────────────────────────────────

@app.websocket("/ws/global-state")
async def websocket_global_state(ws: WebSocket):
    await ws.accept()
    q = asyncio.Queue()
    agent.register_listener(q)
    # Send current state
    await ws.send_json({
        "type": "agent_state_update",
        "state": agent.current_state,
        "activeOltId": agent.verified_olt_id,
        "activeIp": agent.active_ip
    })
    try:
        while True:
            msg = await q.get()
            await ws.send_json(msg)
    except WebSocketDisconnect:
        agent.unregister_listener(q)
    except Exception as e:
        logger.error(f"Global WS Error: {e}")
        agent.unregister_listener(q)

class SwitchTargetRequest(BaseModel):
    olt_id: str

# Consolidation: duplicate switch-target removed

# -- DataFetcherAgent Proxy ──────────────────────────────────────────

@app.get("/api/olt/data/{command_id}")
async def fetch_olt_data(command_id: str):
    """Proxy for DataFetcherAgent fetching commands."""
    if agent.current_state != "MATCH":
        return {"error": "NO_CONNECTION"}
        
    cmd_map = {
        "cards": "show card",
        "onus": "show gpon onu state",
        "vlans": "show vlan summary",
    }
    
    cmd_str = cmd_map.get(command_id, command_id)
    out = await network_mgr.execute_command(cmd_str)
    # the frontend would parse the output or we can parse it here
    return {"raw_output": out}



# ── C3xx ONU Telnet & Parsing Logic ──────────────────────────────────────

def _run_telnet_command(ip, user, password, enable_pwd, command, onu_index=None, port=23):
    """Automated Telnet session for OLT C3xx using persistent session with locking."""
    lock = telnet_session_mgr.get_lock(ip)
    with lock:
        tn = telnet_session_mgr.get_session(ip, user, password, enable_pwd, port=port)
        if not tn:
            return None

        try:
            # 1. Bersihkan buffer Telnet secara solid & reliable (Flush Buffer)
            time.sleep(0.15)  # Beri waktu agar paket sisa di jaringan sempat tiba di socket buffer
            while True:
                try:
                    data = tn.read_very_eager()
                    if not data:
                        break
                except Exception:
                    break
                time.sleep(0.05)

            # 2. Prompt Sanitizer - Keluar dari sub-konteks jika tersangkut
            for _ in range(3):
                tn.write(b"\n")
                _, _, prompt_bytes = tn.expect([b"#", b">"], timeout=1)
                prompt_str = prompt_bytes.decode('ascii', errors='ignore')
                if "gpon-onu-mng" in prompt_str or "(config-if" in prompt_str:
                    logger.info(f"[TELNET-SANITY] Sesi tersangkut di: '{prompt_str.strip()}'. Mengirim 'exit'...")
                    tn.write(b"exit\n")
                    time.sleep(0.15)
                else:
                    break

            if isinstance(command, str):
                commands = [command]
            else:
                commands = command
                
            full_output = ""
            
            # Sequentially send commands and wait for prompt after each
            for cmd in commands:
                tn.write(cmd.encode('ascii') + b"\n")
                
                cmd_output = ""
                while True:
                    # Expect prompt OR --More--
                    # Using regex for prompts to be more robust
                    idx, obj, chunk = tn.expect([b"#", b">", b"\\(config\\)#", b"--More--"], timeout=10)
                    chunk_str = chunk.decode('ascii', errors='replace')
                    cmd_output += chunk_str
                    
                    if idx == 3: # Got --More--
                        tn.write(b" ") # Send space to get more
                        continue
                    else:
                        # Found a final prompt (#, >, or (config)#)
                        break
                
                # Strip echo dari OLT C6xx (C6xx mengirim kembali command yang diterima,
                # sehingga command muncul 2x: 1x dari echo OLT + 1x dari prepend Python).
                # Fix v3 (Komprehensif):
                # - Exact match: guard turun ke 4 agar command pendek ('exit') ikut ter-strip
                # - Startswith: guard tetap 10 agar C3xx tidak false positive
                # - Strip baris lanjutan '$': C6xx mem-wrap echo panjang ke baris baru
                #   dengan prefix '$' → semua baris '$' setelah echo ikut dihapus.
                cmd_output_clean = cmd_output
                stripped = cmd_output.lstrip("\r\n ")
                lines = stripped.split("\n")
                cmd_clean = cmd.strip()
                if lines:
                    first_line = lines[0].strip()
                    is_echo = (
                        (len(first_line) >= 4 and first_line == cmd_clean)           # exact match (termasuk 'exit')
                        or (len(first_line) >= 10 and cmd_clean.startswith(first_line))  # echo terpotong (command panjang)
                    )
                    if is_echo:
                        # Skip baris echo pertama + baris lanjutan '$' dari C6xx
                        skip = 1
                        while skip < len(lines):
                            next_stripped = lines[skip].strip()
                            if next_stripped.startswith("$") or next_stripped == "":
                                skip += 1
                            else:
                                break
                        cmd_output_clean = "\n".join(lines[skip:])

                # Prepend the command to the output so it's visible in logs
                full_output += f"{cmd}\n{cmd_output_clean}"
                
                # Small delay between commands
                time.sleep(0.1)
            
            # Log to terminal for debugging
            print(f"\n--- [RAW CLI OUTPUT FROM {ip}] ---\n{full_output}\n--- [END OUTPUT] ---\n")
            
            # Persist to database if onu_index is provided
            if onu_index and SessionLocal:
                try:
                    with SessionLocal() as db:
                        new_log = ONUCLILog(
                            onu_index=onu_index,
                            command="\n".join(commands) if not isinstance(command, str) else command,
                            output=full_output,
                            timestamp=datetime.utcnow()
                        )
                        db.add(new_log)
                        db.commit()
                except Exception as ex:
                    logger.error(f"[CLI LOG ERROR] Failed to save log for {onu_index}: {ex}")

            return full_output
        except Exception as e:
            logger.info(f"Telnet Command Execution Error on {ip}: {e}")
            # Mark session as dead
            if ip in telnet_session_mgr.sessions:
                try: telnet_session_mgr.sessions[ip].close()
                except: pass
                del telnet_session_mgr.sessions[ip]
            return None

def _parse_c3xx_onus(raw_text):
    """Parses 'show gpon onu state' for C3xx and extracts components."""
    onus = []
    for line in raw_text.splitlines():
        line = line.strip()
        if not line: continue
        
        # Super robust regex: look for anything that looks like shelf/slot/port:id
        # Example: 1/1/1:1 or gpon-onu_1/1/1:1
        match = re.search(r'(?:gpon[-_]onu[-_])?((\d+)/(\d+)/(\d+):(\d+))', line, re.IGNORECASE)
        if match:
            full_idx, shelf, slot, port, onu_id = match.groups()
            
            # Extract phase (status) if possible, but don't fail if not found
            # Phase is usually the 4th column (after index, admin, omcc)
            cols = line.split()
            phase = "unknown"
            if len(cols) >= 4:
                phase = cols[3]
            elif len(cols) == 2: # Index and Phase
                phase = cols[1]

            onus.append({
                'id': f"state-{full_idx}",
                'onu_index': full_idx,
                'oltCard': int(slot),
                'port': int(port),
                'onuNumber': int(onu_id),
                'status': 'online' if phase.upper() == 'WORKING' else 'offline',
                'phase': phase,
                'sn': '-',
                'onuType': 'Unknown'
            })


    return onus



def _parse_c3xx_uncfg_onus(raw_text):
    """Parses 'show pon onu uncfg' for C3xx."""
    onus = []
    # Can be gpon-olt_1/1/1 or gpon-onu_1/1/1:1
    for line in raw_text.strip().split('\n'):
        # Match rack/slot/port:onu_id (onu_id is optional for uncfg)
        idx_match = re.search(r'(\d+)/(\d+)/(\d+)(?::(\d+))?', line)
        if not idx_match:
            continue
        rack, slot, port, onu_id = idx_match.groups()
        if onu_id is None:
            onu_id = 0
            
        # Match SN (10 to 16 uppercase hex or ZTEG... format)
        sn_match = re.search(r'([A-Z0-9]{10,16})', line)
        if not sn_match:
            continue
        sn = sn_match.group(1)
        
        onus.append({
            "id": f"uncfg-{rack}-{slot}-{port}-{sn}",
            "status": "unregistered",
            "oltCard": int(slot),
            "port": int(port),
            "onuNumber": int(onu_id),
            "sn": sn,
            "onuType": "Unknown",
            "trafficUp": 0,
            "trafficDown": 0,
            "opticalPower": 0,
            "rack": rack
        })
    return onus

def _parse_olt_cards(raw_text):
    """Parses 'show card' for ZTE OLTs."""
    cards = []
    lines = raw_text.strip().split('\n')
    
    # Matches the outer structure: Rack, Shelf, Slot, CfgType, [Middle Stuff], Status
    pattern = r'^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*(.*?)\s+(INSERVICE|CONFIGING|CONFIGFAILED|DISABLE|HWONLINE|OFFLINE|STANDBY|TYPEMISMATCH|NOPOWER)\s*$'
    
    for line in lines:
        match = re.search(pattern, line, re.IGNORECASE)
        if match:
            rack, shelf, slot, cfg_type, middle, status = match.groups()
            middle_parts = middle.split()
            
            real_type = "-"
            port = 0
            hard_ver = "-"
            soft_ver = "-"
            
            # Heuristic to parse the middle section (RealType, Port, HardVer, SoftVer)
            if len(middle_parts) >= 1:
                # If first part is a digit, RealType is missing
                if middle_parts[0].isdigit():
                    port = int(middle_parts[0])
                    if len(middle_parts) > 1:
                        hard_ver = middle_parts[1]
                    if len(middle_parts) > 2:
                        soft_ver = middle_parts[2]
                else:
                    real_type = middle_parts[0]
                    if len(middle_parts) > 1 and middle_parts[1].isdigit():
                        port = int(middle_parts[1])
                        if len(middle_parts) > 2:
                            hard_ver = middle_parts[2]
                        if len(middle_parts) > 3:
                            soft_ver = middle_parts[3]
                    else:
                        # Sometimes port is missing but versions exist
                        if len(middle_parts) > 1:
                            hard_ver = middle_parts[1]
                        if len(middle_parts) > 2:
                            soft_ver = middle_parts[2]
            
            cards.append({
                "id": f"card-{shelf}-{slot}",
                "shelf": int(shelf),
                "slot": int(slot),
                "configuredType": cfg_type,
                "cardName": real_type,
                "port": port,
                "hardwareVersion": hard_ver,
                "softwareVersion": soft_ver,
                "status": status.upper()
            })
    return cards


@app.get("/api/onus/c3xx")
def get_c3xx_onus(db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Fetch live ONU list from C3xx OLT — stripped for overhaul."""
    return []


# ── GET /api/debug/snmp-walk ─────────────────────────────────────────────────
# Use this endpoint to discover which SNMP OIDs your ZTE OLT firmware exposes.
# Call it first before using SNMP-based monitoring endpoints.

@app.get("/api/debug/snmp-walk")
def debug_snmp_walk(oid: str = "1.3.6.1.4.1.3902.1082", db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """
    [DEBUG] Walks the ZTE enterprise MIB subtree on the active OLT.
    Returns all OIDs and values found. Use to verify SNMP is enabled and
    to discover firmware-specific OID paths.

    Query params:
      oid  — OID subtree to walk (default: ZTE enterprise root)
    """
    olt_id = get_selected_olt_id(db)
    if not olt_id:
        return {"error": "No OLT selected", "data": {}}

    profile = db.query(OLTProfileDB).filter(OLTProfileDB.olt_type == olt_id).first()
    if not profile or not profile.in_band_ip:
        return {"error": "No profile/IP found", "data": {}}

    ip = profile.in_band_ip
    community = getattr(profile, "snmp_community", None) or "public"

    logger.info(f"[SNMP DEBUG WALK] Walking {ip} oid={oid} community='{community}'")
    results = snmp.snmp_walk(ip, community, oid, use_cache=False)

    return {
        "ip": ip,
        "community": community,
        "oid_root": oid,
        "entry_count": len(results),
        "data": results,
    }


@app.get("/api/olt/cards")
async def get_olt_cards(refresh: bool = False, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """
    Fetch OLT card inventory using SNMP (New Standard).
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    olt_type = get_selected_olt_id(db)
    if not olt_type:
        return []
    profile = db.query(OLTProfileDB).filter(OLTProfileDB.olt_type == olt_type).first()
    if not profile or not profile.in_band_ip:
        return []

    ip = profile.in_band_ip
    community = getattr(profile, "snmp_community", None) or "public"
    
    import time
    now = time.time()
    
    # Check cache (3600 seconds TTL - 1 hour) - bypass if refresh=True
    if not refresh and ip in olt_card_cache and olt_card_cache[ip] and (now - olt_card_cache_time.get(ip, 0) < 3600):
        logger.info(f"[CARDS] Cache hit for {ip}")
        return olt_card_cache[ip]

    # SingleFlight: prevent cache stampede for 10+ concurrent users
    sf_key = f"cards:{ip}:{refresh}"

    async def _do_fetch_cards():
        return await _fetch_cards(ip, community, olt_type, now)

    return await _sf.do(sf_key, _do_fetch_cards)


async def _fetch_cards(ip, community, olt_type, now):
    """Inner fetch — called once per SF group, result shared to all waiters."""
    
    is_c6xx = "c6" in olt_type.lower()
    fetch_plan = {
        "idx":    OID["olt_card_index"],
        "type":   OID["olt_card_type"],
        "port":   OID["olt_card_port"],
        "hw_ver": OID["olt_card_hw_ver"],
        "status": OID["olt_card_status"],
        "cfg_s":  OID["olt_card_cfg_status"],
    }
    
    # Add software version OID if C3xx
    is_c3xx = olt_type.lower() in ("c300", "c320")
    if is_c3xx:
        fetch_plan["sw_ver"] = OID["olt_card_sw_ver_c3xx"]

    logger.info(f"[CARDS] Fetching {len(fetch_plan)} tables for {ip} (Type: {olt_type}) sequentially with breathing room")
    
    try:
        # Run walks sequentially with breathing room to protect low-CPU OLT agents
        results_map = {}
        for key, oid_root in fetch_plan.items():
            try:
                if is_c6xx:
                    res = await snmp.async_snmp_bulkwalk(ip, community, oid_root, timeout=3)
                else:
                    res = await snmp.async_snmp_walk(ip, community, oid_root, timeout=3)
                results_map[key] = res
            except Exception as e:
                logger.error(f"[CARDS MULTI ERROR] Column '{key}' failed for {ip}: {e}")
                results_map[key] = {}
            # Breathe time for OLT's weak SNMP engine
            await asyncio.sleep(0.1)
        
        idx_map    = results_map.get("idx", {})
        type_map   = results_map.get("type", {})
        port_map   = results_map.get("port", {})
        hw_ver_map = results_map.get("hw_ver", {})
        status_map = results_map.get("status", {})
        cfg_s_map  = results_map.get("cfg_s", {})
        sw_ver_map = results_map.get("sw_ver", {}) if is_c3xx else {}

        base_idx = OID["olt_card_index"]
        cards = []
        for full_oid, val in idx_map.items():
            suffix = snmp.extract_oid_suffix(full_oid, base_idx)
            info = snmp.decode_card_index(suffix)
            if not info: continue
            
            rack, shelf, slot = info["rack"], info["shelf"], info["slot"]
            
            def _get(table: dict, base_key: str) -> str:
                return table.get(f"{OID[base_key]}.{suffix}", "-")

            c_type     = _get(type_map,   "olt_card_type")
            c_port     = _get(port_map,   "olt_card_port")
            hw_version = _get(hw_ver_map, "olt_card_hw_ver")
            status_raw = _get(status_map, "olt_card_status")
            cfg_raw    = _get(cfg_s_map,  "olt_card_cfg_status")
            
            sw_version = "-"
            if olt_type.lower() in ("c300", "c320"):
                 sw_version = _get(sw_ver_map, "olt_card_sw_ver_c3xx")

            # Map Status using existing CARD_STATUS_MAP
            try:
                s_int = int(status_raw)
                status_str = CARD_STATUS_MAP.get(s_int, status_raw)
            except:
                status_str = status_raw

            cards.append({
                "id": f"card-{rack}-{shelf}-{slot}",
                "rack": rack, "shelf": shelf, "slot": slot,
                "configuredType": c_type,
                "cardName": c_type, 
                "port": c_port,
                "hardwareVersion": hw_version,
                "softwareVersion": sw_version,
                "status": status_str,
                "cfgStatus": cfg_raw,
                "_source": "snmp_new"
            })
            
        if cards:
             # Sort by Rack, Shelf, Slot
             cards.sort(key=lambda x: (x['rack'], x['shelf'], x['slot']))
             # Update cache
             olt_card_cache[ip] = cards
             olt_card_cache_time[ip] = now
             save_cards_cache()
             return cards

    except Exception as e:
        logger.error(f"[CARDS] SNMP error for {ip}: {e}")
        # Graceful fallback: return cache if exists even if expired
        if ip in olt_card_cache and olt_card_cache[ip]:
            logger.info(f"[CARDS] Returning stale cache for {ip} due to SNMP error")
            return olt_card_cache[ip]

    return []




def _parse_onu_stats(state_text, uncfg_text):
    stats = {"online": 0, "offline": 0, "los": 0, "unconfigured": 0}
    if state_text:
        for line in state_text.split('\n'):
            line_lower = line.lower()
            if "working" in line_lower:
                stats["online"] += 1
            elif "los" in line_lower:
                stats["los"] += 1
            elif "offline" in line_lower or "dyinggasp" in line_lower:
                stats["offline"] += 1
    if uncfg_text:
        for line in uncfg_text.split('\n'):
            line_lower = line.lower()
            if "gpon-onu_" in line_lower or "gpon_onu-" in line_lower or "epon-onu_" in line_lower or "unknown" in line_lower:
                if "state" not in line_lower and "sn" not in line_lower and "---" not in line_lower:
                    stats["unconfigured"] += 1
    return stats


@app.get("/api/agent/vitals")
async def get_olt_vitals(refresh: bool = False, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """
    Retrieves real-time OLT hardware vitals (temperature & uptime) via SNMP in parallel.
    Supports C3xx and C6xx OID mappings.
    """
    # [MASTER KILL SWITCH] Prevent Ghost Data: Return empty if agent is currently switching/verifying
    if agent.current_state == "LOADING":
        return {
            "temperature": None,
            "thresholds": {"low": None, "high": None, "critical": None},
            "uptime": "Syncing...",
            "ip": "-",
            "olt_type": agent.verified_olt_id or "switching..."
        }

    olt_type_raw = get_selected_olt_id(db)
    if not olt_type_raw:
        raise HTTPException(status_code=404, detail="No OLT selected in settings")
    olt_type = olt_type_raw.lower() # 'c300', 'c320', 'c600'
    profile = db.query(OLTProfileDB).filter(OLTProfileDB.olt_type == olt_type_raw).first()
    
    if not profile or not profile.in_band_ip:
        raise HTTPException(status_code=404, detail="Active OLT profile not found or missing IP")

    ip = profile.in_band_ip
    
    import time
    now = time.time()
    if not refresh and ip in vitals_cache and vitals_cache[ip] and (now - vitals_cache_time.get(ip, 0) < 30):
        logger.info(f"OLT Vitals Cache hit for {ip}")
        return vitals_cache[ip]

    # SingleFlight: prevent cache stampede for 10+ concurrent users
    community = getattr(profile, "snmp_community", None) or "public"
    sf_key = f"vitals:{ip}:{refresh}"

    async def _do_fetch_vitals():
        return await _fetch_vitals(ip, community, olt_type, now)

    return await _sf.do(sf_key, _do_fetch_vitals)


async def _fetch_vitals(ip, community, olt_type, now):
    """Inner fetch — called once per SF group, result shared to all waiters."""
    community = community  # explicit for clarity
    
    # OID Mappings based on User Request
    vitals_oids = {}
    if olt_type in ['c300', 'c320']:
        vitals_oids = {
            "temp": ".1.3.6.1.4.1.3902.1082.10.10.2.1.5.1.3.1.1",
            "high": ".1.3.6.1.4.1.3902.1082.10.10.2.1.5.1.4.1.1",
            "crit": ".1.3.6.1.4.1.3902.1082.10.10.2.1.5.1.5.1.1",
            "low":  ".1.3.6.1.4.1.3902.1082.10.10.2.1.5.1.6.1.1"
        }
    else: # Default to C6xx mapping
        vitals_oids = {
            "temp": "1.3.6.1.4.1.3902.3.6002.2.4.1.3.1.1",
            "low":  "1.3.6.1.4.1.3902.3.6002.2.4.1.4.1.1",
            "crit": "1.3.6.1.4.1.3902.3.6002.2.4.1.5.1.1",
            "high": "1.3.6.1.4.1.3902.3.6002.2.4.1.6.1.1"
        }
    
    uptime_oid = ".1.3.6.1.2.1.1.3.0"
    
    # Fetch Data in Parallel (timeout 3 seconds)
    keys = list(vitals_oids.keys())
    oids = [vitals_oids[k] for k in keys]
    
    # Create parallel SNMP GET tasks
    tasks = [snmp._async_snmp_get(ip, community, oid, port=161, timeout=3) for oid in oids]
    tasks.append(snmp._async_snmp_get(ip, community, uptime_oid, port=161, timeout=3))
    
    # Execute all 5 SNMP GETs concurrently
    results = await asyncio.gather(*tasks)
    
    vitals_data = {}
    for idx, key in enumerate(keys):
        val = results[idx]
        try:
            # Extract number from "INTEGER: 44" or similar
            if val and "INTEGER:" in val:
                val = val.split("INTEGER:")[1].strip()
            vitals_data[key] = int(val) if val is not None else None
        except:
            vitals_data[key] = None
            
    raw_uptime = results[-1]
    
    # Parse Uptime using precise numeric Timeticks (1/100 sec)
    uptime_str = "—"
    if raw_uptime:
        # Extract numeric value: Look for parentheses first, fallback to raw digits
        numeric_match = re.search(r"\((\d+)\)", raw_uptime)
        val_str = None
        if numeric_match:
            val_str = numeric_match.group(1)
        elif raw_uptime.strip().isdigit():
            val_str = raw_uptime.strip()

        if val_str:
            total_ticks = int(val_str)
            # 1. SNMP Timeticks are 1/100 sec, so divide by 100 first
            total_seconds = total_ticks // 100
            
            # 2. Apply division formulas
            days = total_seconds // 86400
            rem_days = total_seconds % 86400
            
            hours = rem_days // 3600
            rem_hours = rem_days % 3600
            
            minutes = rem_hours // 60
            seconds = rem_hours % 60
            
            # 3. Format output
            parts = []
            if days > 0: parts.append(f"{days}d")
            parts.append(f"{hours}h")
            parts.append(f"{minutes}m")
            parts.append(f"{seconds}s")
            uptime_str = " ".join(parts)
        else:
            # Fallback to string if no numbers detected
            uptime_str = raw_uptime

    res = {
        "temperature": vitals_data.get("temp"),
        "thresholds": {
            "low": vitals_data.get("low"),
            "high": vitals_data.get("high"),
            "critical": vitals_data.get("crit")
        },
        "uptime": uptime_str,
        "ip": ip,
        "olt_type": olt_type
    }
    vitals_cache[ip] = res
    vitals_cache_time[ip] = now
    return res

@app.get("/api/dashboard/onu-stats")
def get_dashboard_onu_stats(db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """
    ONU status counts for Dashboard cards.
    Strategy: SNMP-first (zxGponOntPhaseState + show pon onu uncfg count),
              fallback to Telnet CLI parsing.
    Fields: online, offline, los, unconfigured (also: offline_loss = offline + los)
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    olt_type = get_selected_olt_id(db)
    if not olt_type:
        return {"online": 0, "offline": 0, "los": 0, "unconfigured": 0, "offline_loss": 0}
    profile = db.query(OLTProfileDB).filter(OLTProfileDB.olt_type == olt_type).first()
    if not profile or not profile.in_band_ip:
        return {"online": 0, "offline": 0, "los": 0, "unconfigured": 0, "offline_loss": 0}

    ip        = profile.in_band_ip
    community = getattr(profile, "snmp_community", None) or "public"
    now       = time.time()

    # ── Database Driven Stats (Optimized via Brain-Back) ─────────────────
    try:
        from sqlalchemy import func
        status_groups = db.query(
            UnconfiguredONU.status,
            func.count(UnconfiguredONU.id)
        ).filter(
            UnconfiguredONU.olt_ip == ip
        ).group_by(
            UnconfiguredONU.status
        ).all()
        
        # Build lowercase status map
        status_map = {}
        for status_str, count in status_groups:
            k = status_str.lower() if status_str else ""
            status_map[k] = status_map.get(k, 0) + count
            
        online_count = status_map.get("online", 0)
        offline_count = status_map.get("offline", 0)
        los_count = status_map.get("los", 0)
        unconf_registered_count = status_map.get("unconfigured", 0)
        
        # Count unregistered ONUs
        unreg_count = db.query(UnregisteredONU).filter(UnregisteredONU.olt_ip == ip).count()
        
        unconfigured_total = unreg_count + unconf_registered_count
        
        stats = {
            "online": online_count,
            "offline": offline_count,
            "los": los_count,
            "unconfigured": unconfigured_total,
            "offline_loss": offline_count + los_count
        }
        
        logger.info(f"[DASHBOARD DB OPTIMIZED] {ip} → {stats}")
        return stats
    except Exception as e:
        logger.error(f"[DASHBOARD DB ERROR] {ip}: {e}")

    return {"online": 0, "offline": 0, "los": 0, "unconfigured": 0, "offline_loss": 0}





def _get_active_profile(db: Session):
    olt_id = get_selected_olt_id(db)
    if not olt_id:
        return None
    return db.query(OLTProfileDB).filter(OLTProfileDB.olt_type == olt_id).first()

# ── Provisioning Parsers & Endpoints ────────────────────────────────────


def _parse_vlan_summary(raw_text: str) -> list:
    """Parse 'show vlan summary' to get a list of active VLAN IDs."""
    vlans = []
    in_details = False
    for line in raw_text.splitlines():
        line = line.strip()
        if "Details are following:" in line:
            in_details = True
            continue
        if in_details and line:
            # Lines might contain comma separated vlans or spaces, e.g. "1, 10, 20" or "1 10 20"
            parts = line.replace(',', ' ').split()
            for part in parts:
                if part.isdigit():
                    vlans.append(int(part))
                elif '-' in part:
                    # Handle range if exists e.g. "10-15"
                    try:
                        start, end = map(int, part.split('-'))
                        vlans.extend(range(start, end + 1))
                    except Exception:
                        pass
    return vlans

def _parse_vlan_details(raw_text: str) -> str:
    """Parse 'show vlan <id>' to extract the name."""
    name = "-"
    for line in raw_text.splitlines():
        line = line.strip()
        if line.lower().startswith("name:"):
            # Expected "Name: VLAN_10" or similar
            name = line.split(":", 1)[1].strip()
            break
        elif line.lower().startswith("name"):
            # Sometimes it's just "name VLAN_10"
            parts = line.split(maxsplit=1)
            if len(parts) > 1:
                name = parts[1].strip()
                break
    return name

@app.get("/api/provisioning/vlans")
async def get_vlans(refresh: bool = False, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    profile = _get_active_profile(db)
    if not profile:
        return []
        
    ip = profile.in_band_ip
    community = profile.snmp_community or "public"
    
    # 1. Try Database first for performance - bypass if refresh=True
    db_vlans = db.query(VLANRecord).filter(VLANRecord.olt_ip == ip).all()
    if not refresh and db_vlans:
        last_upd = db_vlans[0].last_updated
        if datetime.utcnow() - last_upd < timedelta(hours=1):
            return [{"vlanId": v.vlan_id, "vlan_id": v.vlan_id, "name": v.name, "description": v.description} for v in db_vlans]

    logger.info(f"[VLAN] Syncing via SNMP walk on {ip} (Refresh/Initial)")

    # SingleFlight: prevent concurrent SNMP walks for 10+ users
    sf_key = f"vlans:{ip}:{refresh}"
    return await asyncio.get_event_loop().run_in_executor(None, lambda: _fetch_vlans_sync(ip, community, db, db_vlans))


def _fetch_vlans_sync(ip, community, db, db_vlans_fallback):
    """Inner sync fetch — wrapped in executor, result shared via SingleFlight."""
    logger.info(f"[VLAN] SNMP bulkwalk executing for {ip}")
    try:
        # Use SNMP Bulk Walk for massive performance speedup (0.2s vs 18s) and OLT safety
        target_oid = ".1.3.6.1.4.1.3902.1082.40.50.2.1.2"
        results = snmp.snmp_bulkwalk(ip, community, target_oid, max_repetitions=100)
        if not results:
            return [{"vlanId": v.vlan_id, "vlan_id": v.vlan_id, "name": v.name, "description": v.description} for v in db_vlans_fallback]

        vlan_dict = {}
        for full_oid, raw_val in results.items():
            parts = full_oid.split('.')
            if len(parts) < 2: continue
            try:
                vid = int(parts[-1])
                field_type = int(parts[-2])
                if vid not in vlan_dict:
                    vlan_dict[vid] = {"vlanId": vid, "name": "-", "description": "-"}
                if field_type == 2:
                    vlan_dict[vid]["name"] = snmp.decode_snmp_ascii(raw_val)
                elif field_type == 3:
                    vlan_dict[vid]["description"] = snmp.decode_snmp_ascii(raw_val)
            except: continue

        # Persist to Database
        db.query(VLANRecord).filter(VLANRecord.olt_ip == ip).delete()
        for vid, data in vlan_dict.items():
            db.add(VLANRecord(
                vlan_id=vid,
                name=data["name"],
                description=data["description"],
                olt_ip=ip,
                last_updated=datetime.utcnow()
            ))
        db.commit()

        vlan_list = [{"vlanId": v.vlan_id, "vlan_id": v.vlan_id, "name": v.name, "description": v.description} 
                     for v in db.query(VLANRecord).filter(VLANRecord.olt_ip == ip).all()]
        vlan_list.sort(key=lambda x: x["vlanId"])
        return vlan_list
    except Exception as e:
        logger.error(f"[VLAN] SNMP Sync Error: {e}")
        return [{"vlanId": v.vlan_id, "vlan_id": v.vlan_id, "name": v.name, "description": v.description} for v in db_vlans_fallback]

@app.post("/api/provisioning/vlans")
def create_vlan(req: ProvisioningVlanRequest, db: Session = Depends(get_db)):
    profile = _get_active_profile(db)
    if not profile:
        raise HTTPException(status_code=400, detail="No active profile")
    
    ip = profile.in_band_ip
    community = profile.snmp_community or "public"
    vlan_id = req.vlan_id
    vlan_name = req.name or f"VLAN{vlan_id:04d}"
    
    # New ZTE OID mapping for C600
    name_oid = f".1.3.6.1.4.1.3902.1082.40.50.2.1.2.1.2.{vlan_id}"
    desc_oid = f".1.3.6.1.4.1.3902.1082.40.50.2.1.2.1.3.{vlan_id}"
    status_oid = f".1.3.6.1.4.1.3902.1082.40.50.2.1.2.1.50.{vlan_id}"
    
    logger.info(f"[VLAN] Creating VLAN {vlan_id} via SNMP on {ip}")
    with pause_monitoring():
        success = snmp.snmp_set_multi(ip, community, [
        (name_oid, vlan_name, 'str'),
        (desc_oid, req.description or "", 'str'),
        (status_oid, 4, 'int') # 4 = createAndGo
    ])
    
    if not success:
        logger.error(f"[VLAN] SNMP create failed for {vlan_id}. (Ensure SNMP WRITE is enabled)")
        raise HTTPException(status_code=500, detail=f"Failed to create VLAN {vlan_id} via SNMP")
    
    # Update local DB record immediately
    existing = db.query(VLANRecord).filter(VLANRecord.olt_ip == ip, VLANRecord.vlan_id == vlan_id).first()
    if existing:
        existing.name = vlan_name
        existing.description = req.description or ""
        existing.last_updated = datetime.utcnow()
    else:
        db.add(VLANRecord(vlan_id=vlan_id, name=vlan_name, description=req.description or "", olt_ip=ip))
    db.commit()
    
    return {"status": "success"}

@app.put("/api/provisioning/vlans")
def update_vlan(req: ProvisioningVlanRequest, db: Session = Depends(get_db)):
    profile = _get_active_profile(db)
    if not profile:
        raise HTTPException(status_code=400, detail="No active profile")
    
    ip = profile.in_band_ip
    community = profile.snmp_community or "public"
    vlan_id = req.vlan_id
    vlan_name = req.name or f"VLAN{vlan_id:04d}"
    
    # ZTE OID mapping for C600
    name_oid = f".1.3.6.1.4.1.3902.1082.40.50.2.1.2.1.2.{vlan_id}"
    desc_oid = f".1.3.6.1.4.1.3902.1082.40.50.2.1.2.1.3.{vlan_id}"
    
    logger.info(f"[VLAN] Updating VLAN {vlan_id} via SNMP on {ip}")
    with pause_monitoring():
        success = snmp.snmp_set_multi(ip, community, [
        (name_oid, vlan_name, 'str'),
        (desc_oid, req.description or "", 'str')
    ])
    
    if not success:
        logger.error(f"[VLAN] SNMP update failed for {vlan_id}. (Ensure SNMP WRITE is enabled)")
        raise HTTPException(status_code=500, detail=f"Failed to update VLAN {vlan_id} via SNMP")
    
    # Update local DB record
    existing = db.query(VLANRecord).filter(VLANRecord.olt_ip == ip, VLANRecord.vlan_id == vlan_id).first()
    if existing:
        existing.name = vlan_name
        existing.description = req.description or ""
        existing.last_updated = datetime.utcnow()
        db.commit()
    
    return {"status": "success"}

@app.delete("/api/provisioning/vlans")
def delete_vlans(req: ProvisioningVlanDeleteRequest, db: Session = Depends(get_db)):
    profile = _get_active_profile(db)
    if not profile:
        raise HTTPException(status_code=400, detail="No active profile")
        
    if not req.vlan_ids:
        return {"status": "success"}
        
    ip = profile.in_band_ip
    community = profile.snmp_community or "public"
    
    failed_vids = []
    with pause_monitoring():
        for vid in req.vlan_ids:
            # ZTE-specific Status OID: .1.3.6.1.4.1.3902.1082.40.50.2.1.2.1.50.<vid>
            status_oid = f".1.3.6.1.4.1.3902.1082.40.50.2.1.2.1.50.{vid}"
            logger.info(f"[VLAN] Deleting VLAN {vid} via SNMP on {ip}")
            if not snmp.snmp_set_int(ip, community, status_oid, 6): # 6 = destroy
                failed_vids.append(vid)
            
    if failed_vids:
        logger.error(f"[VLAN] SNMP delete failed for {failed_vids}. (Ensure SNMP WRITE is enabled)")
        raise HTTPException(status_code=500, detail=f"Failed to delete VLANs {failed_vids} via SNMP")
    
    # Remove from local DB
    db.query(VLANRecord).filter(VLANRecord.olt_ip == ip, VLANRecord.vlan_id.in_(req.vlan_ids)).delete()
    db.commit()
    
    return {"status": "success"}

def _parse_uplink(raw_text: str) -> list:
    uplinks = []
    lines = raw_text.splitlines()
    current_uplink = {}
    for line in lines:
        line = line.strip()
        m_if = re.match(r"interface\s+(xgei|gei)[_-](\d+)/(\d+)/(\d+)", line)
        if m_if:
            if current_uplink and "interfaceType" in current_uplink:
                uplinks.append(current_uplink)
            current_uplink = {
                "interfaceType": m_if.group(1),
                "shelf": m_if.group(2),
                "slot": m_if.group(3),
                "port": m_if.group(4),
                "mode": "unknown",
                "vlan": "-",
                "tagging": "-"
            }
        elif current_uplink and line.startswith("switchport mode"):
            parts = line.split()
            if len(parts) >= 3:
                current_uplink["mode"] = parts[2]
        elif current_uplink and line.startswith("switchport vlan"):
            parts = line.split()
            if len(parts) >= 4:
                current_uplink["vlan"] = parts[2]
                current_uplink["tagging"] = parts[3]
    if current_uplink and "interfaceType" in current_uplink:
        uplinks.append(current_uplink)
    return uplinks


def _parse_onu_profile(raw_text: str) -> list:
    profiles = []
    current_profile = {}
    for line in raw_text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("Profile name:"):
            if "profileName" in current_profile:
                profiles.append(current_profile)
            current_profile = {
                "profileName": line.split(":", 1)[1].strip(),
                "profile_name": line.split(":", 1)[1].strip(),
                "mode": "-",
                "vlanId": "-",
                "vlan_id": "-",
                "priority": "-"
            }
        elif line.startswith("Tag mode:"):
            current_profile["mode"] = line.split(":", 1)[1].strip()
        elif line.startswith("CVLAN:"):
            current_profile["vlanId"] = line.split(":", 1)[1].strip()
            current_profile["vlan_id"] = line.split(":", 1)[1].strip()
        elif line.startswith("CVLAN priority:"):
            current_profile["priority"] = line.split(":", 1)[1].strip()
            
    if "profileName" in current_profile:
        profiles.append(current_profile)
        
    return profiles

@app.post("/api/provisioning/onu-profiles")
def create_onu_profile(req: ProvisioningOnuProfileRequest, db: Session = Depends(get_db)):
    profile = _get_active_profile(db)
    if not profile:
        raise HTTPException(status_code=400, detail="No active profile")
        
    suffix = snmp.string_to_oid_suffix(req.profile_name)
    root = "1.3.6.1.4.1.3902.1082.500.20.2.6.25.1"
    
    # Add ONU profile vlan using SNMP
    oid_vals = [
        (f"{root}.2.{suffix}", 1, 'int'),
        (f"{root}.3.{suffix}", int(req.vlan_id), 'int'),
        (f"{root}.4.{suffix}", int(req.priority), 'int'),
        (f"{root}.50.{suffix}", 4, 'int')
    ]
    
    community = profile.snmp_community or "public"
    with pause_monitoring():
        success = snmp.snmp_set_multi(profile.in_band_ip, community, oid_vals, timeout=45)
    
    if not success:
        raise HTTPException(
            status_code=504, 
            detail="Failed to create ONU VLAN profile via SNMP. Connection timed out or SNMP WRITE is not enabled on OLT."
        )
    
    # Clear cache
    onu_profile_cache.pop(profile.in_band_ip, None)
    return {"status": "success"}

class ProvisioningOnuProfileEditRequest(BaseModel):
    profile_name: str
    vlan_id: str
    priority: str

@app.put("/api/provisioning/onu-profiles")
def edit_onu_profile(req: ProvisioningOnuProfileEditRequest, db: Session = Depends(get_db)):
    profile = _get_active_profile(db)
    if not profile:
        raise HTTPException(status_code=400, detail="No active profile")
        
    suffix = snmp.string_to_oid_suffix(req.profile_name)
    root = "1.3.6.1.4.1.3902.1082.500.20.2.6.25.1"
    
    oid_vals = [
        (f"{root}.3.{suffix}", int(req.vlan_id), 'int'),
        (f"{root}.4.{suffix}", int(req.priority), 'int')
    ]
    
    community = profile.snmp_community or "public"
    with pause_monitoring():
        success = snmp.snmp_set_multi(profile.in_band_ip, community, oid_vals, timeout=45)
    
    if not success:
        raise HTTPException(
            status_code=504, 
            detail="Failed to edit ONU VLAN profile via SNMP. Connection timed out or SNMP WRITE is not enabled on OLT."
        )
    
    # Clear cache
    onu_profile_cache.pop(profile.in_band_ip, None)
    return {"status": "success"}

@app.get("/api/provisioning/onu-profiles")
async def get_onu_profiles(refresh: bool = False, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    profile = _get_active_profile(db)
    if not profile:
        return []
        
    import time
    now = time.time()
    ip = profile.in_band_ip
    
    # Check cache (1800 seconds / 30 minutes TTL) - bypass if refresh=True
    if not refresh and ip in onu_profile_cache and onu_profile_cache[ip] and (now - onu_profile_cache_time.get(ip, 0) < 1800):
        logger.info(f"ONU Profile Cache hit for {ip}")
        return onu_profile_cache[ip]

    # SingleFlight: prevent cache stampede for 10+ concurrent users
    sf_key = f"onu-profiles:{ip}:{refresh}"
    community = profile.snmp_community or "public"
    return await _sf.do(sf_key, lambda: _fetch_onu_profiles_sync(ip, community, now))


def _fetch_onu_profiles_sync(ip, community, now):
    """Inner sync fetch — called once per SF group, result shared to all waiters."""
    logger.info(f"ONU Profile Cache miss/refresh for {ip}, using SNMP...")
    root_oid = "1.3.6.1.4.1.3902.1082.500.20.2.6.25.1"
    
    try:
        with pause_monitoring():
            walk_res = snmp.snmp_bulkwalk(ip, community, root_oid, max_repetitions=100, timeout=10)
    except Exception as e:
        logger.error(f"[ONU PROFILE SNMP ERROR] Failed to fetch profiles for {ip}: {e}")
        raise HTTPException(
            status_code=504,
            detail=f"Failed to retrieve ONU profiles via SNMP (timeout or access denied): {str(e)}"
        )
        
    if not walk_res:
        return []
        
    profiles_dict = {}
    
    for full_oid, val in walk_res.items():
        suffix = snmp.extract_oid_suffix(full_oid, root_oid)
        if not suffix:
            continue
            
        parts = suffix.split('.')
        col = parts[0]
        ascii_suffix = '.'.join(parts[1:])
        profile_name = snmp.decode_oid_ascii_suffix(ascii_suffix)
        
        # Log parsed profile for debugging
        logger.debug(f"[ONU PROFILE WALK] Suffix: {suffix} -> Col: {col}, Profile: {profile_name}")
        
        if profile_name not in profiles_dict:
            profiles_dict[profile_name] = {
                "profileName": profile_name,
                "profile_name": profile_name,
                "mode": "-",
                "vlanId": "-",
                "vlan_id": "-",
                "priority": "-"
            }
            
        if col == "2":
            profiles_dict[profile_name]["mode"] = "tag" if val == "1" else "-"
        elif col == "3":
            profiles_dict[profile_name]["vlanId"] = val
            profiles_dict[profile_name]["vlan_id"] = val
        elif col == "4":
            profiles_dict[profile_name]["priority"] = val

    profiles = list(profiles_dict.values())
    
    # Update cache
    onu_profile_cache[ip] = profiles
    onu_profile_cache_time[ip] = now
    
    return profiles

@app.delete("/api/provisioning/onu-profiles")
def delete_onu_profiles(req: ProvisioningOnuProfileDeleteRequest, db: Session = Depends(get_db)):
    profile = _get_active_profile(db)
    if not profile:
        raise HTTPException(status_code=400, detail="No active profile")
        
    if not req.profile_names:
        return {"status": "success"}
        
    ip = profile.in_band_ip
    community = profile.snmp_community or "public"
    root_rowstatus = "1.3.6.1.4.1.3902.1082.500.20.2.6.25.1.50"
    
    errors = []
    with pause_monitoring():
        for p_name in req.profile_names:
            suffix = snmp.string_to_oid_suffix(p_name)
            full_oid = f"{root_rowstatus}.{suffix}"
            
            # Set RowStatus to 6 (Destroy)
            success = snmp.snmp_set_int(ip, community, full_oid, 6, timeout=45)
            if not success:
                logger.error(f"SNMP DELETE FAILED for ONU profile '{p_name}' on {ip}")
                errors.append(p_name)
            
    if errors:
        raise HTTPException(
            status_code=504, 
            detail=f"Failed to delete ONU profiles via SNMP: {', '.join(errors)}. Connection timed out or SNMP WRITE is not enabled on OLT."
        )
    
    # Clear cache
    onu_profile_cache.pop(ip, None)
    return {"status": "success"}

def _parse_tcont_profile(raw_text: str) -> list:
    profiles = []
    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    
    i = 0
    while i < len(lines):
        line = lines[i]
        # Look for "Profile name :"
        if "Profile name" in line:
            name = line.split(":", 1)[1].strip()
            # The next line is headers "Type FBW(kbps) ..."
            # The line after that is the values
            if i + 2 < len(lines):
                values = lines[i+2].split()
                if len(values) >= 6:
                    profiles.append({
                        "profileName": name,
                        "type": int(values[0]) if values[0].isdigit() else values[0],
                        "fbw": int(values[1]) if values[1].isdigit() else 0,
                        "abw": int(values[2]) if values[2].isdigit() else 0,
                        "mbw": int(values[3]) if values[3].isdigit() else 0,
                        "priority": int(values[4]) if values[4].isdigit() else 0,
                        "weight": int(values[5]) if values[5].isdigit() else 0,
                    })
                i += 3 # Skip name, header, and values
            else:
                i += 1
        else:
            i += 1
            
    return profiles

@app.get("/api/provisioning/tcont-profiles")
async def get_tcont_profiles(refresh: bool = False, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    profile = _get_active_profile(db)
    if not profile:
        return []
        
    import time
    now = time.time()
    ip = profile.in_band_ip
    community = profile.snmp_community or "public"
    
    # Check cache (1800 seconds / 30 minutes TTL) - Skip if refresh=True
    if not refresh and ip in tcont_profile_cache and tcont_profile_cache[ip] and (now - tcont_profile_cache_time.get(ip, 0) < 1800):
        logger.info(f"TCONT Profile Cache hit for {ip}")
        return tcont_profile_cache[ip]

    # SingleFlight: prevent cache stampede for 10+ concurrent users
    sf_key = f"tcont-profiles:{ip}:{refresh}"
    return await _sf.do(sf_key, lambda: _fetch_tcont_profiles_sync(ip, community, now))


def _fetch_tcont_profiles_sync(ip, community, now):
    """Inner sync fetch — called once per SF group, result shared to all waiters."""
    logger.info(f"TCONT Profile (SNMP) for {ip}, walking table root...")
    
    try:
        # User's provided root: 1.3.6.1.4.1.3902.1082.500.10.2.1.2.1
        table_root = "1.3.6.1.4.1.3902.1082.500.10.2.1.2.1"
        with pause_monitoring():
            walk_data = snmp.snmp_bulkwalk(ip, community, table_root, max_repetitions=100, timeout=10)
        
        if not walk_data:
            logger.warning(f"No SNMP data returned for table root {table_root} on {ip}")
            return []

        # Group data by index suffix (which contains the encoded name)
        # OID structure: ...10.2.1.2.1.<column>.<name_len>.<ascii_codes>
        rows = {} 
        
        for full_oid, val in walk_data.items():
            suffix = snmp.extract_oid_suffix(full_oid, table_root)
            parts = suffix.split(".")
            if len(parts) < 3: # Need at least col, len, and 1 char
                continue
            
            col_id = parts[0]
            # row_idx is everything after column ID (len + ascii codes)
            row_idx = ".".join(parts[1:])
            
            if row_idx not in rows:
                # Decode profile name from ASCII codes in the suffix
                # parts[1] is length, parts[2:] are the codes
                try:
                    name_parts = parts[2:]
                    decoded_name = "".join([chr(int(c)) for c in name_parts])
                    rows[row_idx] = {"profileName": decoded_name, "type": 0, "fbw": 0, "abw": 0, "mbw": 0}
                except:
                    rows[row_idx] = {"profileName": row_idx, "type": 0, "fbw": 0, "abw": 0, "mbw": 0}
            
            # Mapping based on user's snmpwalk output:
            # Col 2: FBW, Col 3: ABW, Col 4: MBW, Col 5: Type
            v_int = int(val) if val.isdigit() else 0
            if col_id == "2":
                rows[row_idx]["fbw"] = v_int
            elif col_id == "3":
                rows[row_idx]["abw"] = v_int
            elif col_id == "4":
                rows[row_idx]["mbw"] = v_int
            elif col_id == "5":
                rows[row_idx]["type"] = v_int

        profiles = list(rows.values())
        profiles.sort(key=lambda x: x["profileName"])
        
        tcont_profile_cache[ip] = profiles
        tcont_profile_cache_time[ip] = now
        return profiles
        
    except Exception as e:
        logger.error(f"[TCONT PROFILE SNMP ERROR] Failed to fetch TCONT profiles for {ip}: {e}")
        raise HTTPException(
            status_code=504,
            detail=f"Failed to retrieve TCONT profiles via SNMP (timeout or access denied): {str(e)}"
        )

@app.post("/api/provisioning/tcont-profiles")
def create_tcont_profile(req: ProvisioningTcontProfileRequest, db: Session = Depends(get_db)):
    profile = _get_active_profile(db)
    if not profile:
        raise HTTPException(status_code=400, detail="No active profile")
        
    suffix = snmp.string_to_oid_suffix(req.profile_name)
    root = "1.3.6.1.4.1.3902.1082.500.10.2.1.2.1"
    
    oid_vals = [
        (f"{root}.5.{suffix}", req.type),
    ]
    
    if req.type == 1:
        oid_vals.append((f"{root}.2.{suffix}", req.fbw))
    elif req.type == 2:
        oid_vals.append((f"{root}.3.{suffix}", req.abw))
    elif req.type == 3:
        oid_vals.append((f"{root}.3.{suffix}", req.abw))
        oid_vals.append((f"{root}.4.{suffix}", req.mbw))
    elif req.type == 4:
        oid_vals.append((f"{root}.4.{suffix}", req.mbw))
    elif req.type == 5:
        oid_vals.append((f"{root}.2.{suffix}", req.fbw))
        oid_vals.append((f"{root}.3.{suffix}", req.abw))
        oid_vals.append((f"{root}.4.{suffix}", req.mbw))

    # Always add RowStatus = 4 (createAndReady)
    oid_vals.append((f"{root}.50.{suffix}", 4))
    
    community = profile.snmp_community or "public"
    with pause_monitoring():
        success = snmp.snmp_set_multi_ints(profile.in_band_ip, community, oid_vals, timeout=45)
    
    if not success:
        raise HTTPException(
            status_code=504, 
            detail=f"Failed to create TCONT profile {req.profile_name} via SNMP. Connection timed out or SNMP WRITE is not enabled on OLT."
        )
    
    # Clear cache
    tcont_profile_cache.pop(profile.in_band_ip, None)
    return {"status": "success"}

@app.put("/api/provisioning/tcont-profiles")
def edit_tcont_profile(req: ProvisioningTcontProfileEditRequest, db: Session = Depends(get_db)):
    profile = _get_active_profile(db)
    if not profile:
        raise HTTPException(status_code=400, detail="No active profile")
        
    suffix = snmp.string_to_oid_suffix(req.profile_name)
    root = "1.3.6.1.4.1.3902.1082.500.10.2.1.2.1"
    
    oid_vals = [
        (f"{root}.5.{suffix}", req.type),
    ]
    
    if req.type == 1:
        oid_vals.append((f"{root}.2.{suffix}", req.fbw))
    elif req.type == 2:
        oid_vals.append((f"{root}.3.{suffix}", req.abw))
    elif req.type == 3:
        oid_vals.append((f"{root}.3.{suffix}", req.abw))
        oid_vals.append((f"{root}.4.{suffix}", req.mbw))
    elif req.type == 4:
        oid_vals.append((f"{root}.4.{suffix}", req.mbw))
    elif req.type == 5:
        oid_vals.append((f"{root}.2.{suffix}", req.fbw))
        oid_vals.append((f"{root}.3.{suffix}", req.abw))
        oid_vals.append((f"{root}.4.{suffix}", req.mbw))
    
    community = profile.snmp_community or "public"
    with pause_monitoring():
        success = snmp.snmp_set_multi_ints(profile.in_band_ip, community, oid_vals, timeout=45)
    
    if not success:
        raise HTTPException(
            status_code=504, 
            detail=f"Failed to update TCONT profile {req.profile_name} via SNMP. Connection timed out or SNMP WRITE is not enabled on OLT."
        )
    
    # Clear cache
    tcont_profile_cache.pop(profile.in_band_ip, None)
    return {"status": "success"}

@app.delete("/api/provisioning/tcont-profiles")
def delete_tcont_profiles(req: ProvisioningTcontProfileDeleteRequest, db: Session = Depends(get_db)):
    profile = _get_active_profile(db)
    if not profile:
        raise HTTPException(status_code=400, detail="No active profile")
        
    if not req.profile_names:
        return {"status": "success"}
    
    ip = profile.in_band_ip
    community = profile.snmp_community or "public"
    
    # RowStatus OID root for TCONT Profile: 1.3.6.1.4.1.3902.1082.500.10.2.1.2.1.50
    row_status_root = "1.3.6.1.4.1.3902.1082.500.10.2.1.2.1.50"
    
    errors = []
    with pause_monitoring():
        for p_name in req.profile_names:
            # Convert name to ASCII index suffix (e.g., "TEST" -> "4.84.69.83.84")
            suffix = snmp.string_to_oid_suffix(p_name)
            full_oid = f"{row_status_root}.{suffix}"
            
            # Set RowStatus to 6 (Destroy)
            success = snmp.snmp_set_int(ip, community, full_oid, 6, timeout=45)
            if not success:
                logger.error(f"SNMP DELETE FAILED for profile '{p_name}' on {ip}")
                errors.append(p_name)
    
    if errors:
        raise HTTPException(
            status_code=504, 
            detail=f"Failed to delete profiles via SNMP: {', '.join(errors)}. Connection timed out or SNMP WRITE is not enabled on OLT."
        )

    # Clear cache
    tcont_profile_cache.pop(ip, None)
    return {"status": "success"}




# ── ONU Detail Parsers ────────────────────────────────────────────────────

def _parse_baseinfo(raw: str) -> dict:
    """
    Parse 'show gpon onu baseinfo gpon-olt_<rack>/<slot>/<port>' output (C320, 3-number format).
    Returns dict: { "rack/slot/port:index": sn_str }

    The SN value is in the 'AuthInfo' column, NOT an 'SN' column.

    Expected table format (C320):
      OnuIndex              Admin   OmccState  Phase    AuthType  AuthInfo
      gpon-onu_1/1/1:1     enable  enable     working  sn        ZTEG12345678
      gpon-onu_1/1/1:2     enable  enable     working  sn        ZTEG87654321
    """
    result = {}
    lines = raw.splitlines()

    # ── Strategy 1: Column-position based (most accurate) ────────────────
    # Find the header line that contains 'AuthInfo'
    header_idx = None
    auth_info_col = None
    for i, line in enumerate(lines):
        if re.search(r'AuthInfo', line, re.IGNORECASE):
            header_idx = i
            # Record the character position of 'AuthInfo' in the header
            m = re.search(r'AuthInfo', line, re.IGNORECASE)
            if m:
                auth_info_col = m.start()
            break

    if header_idx is not None and auth_info_col is not None:
        # Parse each data row after the header
        for line in lines[header_idx + 1:]:
            # Look for gpon-onu index at the start of the line
            idx_match = re.match(
                r'\s*(?:gpon[-_]onu[-_])?(\d+)/(\d+)/(\d+):(\d+)',
                line, re.IGNORECASE
            )
            if idx_match:
                rack, slot, port, onu_idx = idx_match.groups()
                key = f"{rack}/{slot}/{port}:{onu_idx}"
                # Extract the AuthInfo value at the recorded column position
                if len(line) > auth_info_col:
                    # Take everything from the AuthInfo column to end-of-token
                    remainder = line[auth_info_col:]
                    token_match = re.match(r'(\S+)', remainder)
                    if token_match:
                        sn = token_match.group(1).strip()
                        # Only store if it looks like a valid SN (not 'N/A', '-', etc.)
                        if sn and sn not in ('-', 'N/A', 'n/a', 'null'):
                            result[key] = sn
        if result:
            return result

    # ── Strategy 2: Regex fallback — match index + skip to AuthInfo value ─
    # Pattern: gpon-onu_1/1/1:1  enable  enable  working  sn  ZTEG12345678
    #          captures the LAST whitespace-separated token after the index + 4 fields
    fallback = re.compile(
        r'(?:gpon[-_]onu[-_])?(\d+)/(\d+)/(\d+):(\d+)'  # ONU index
        r'(?:\s+\S+){4}\s+'                         # skip: Admin OmccState Phase AuthType
        r'(\S+)',                                     # AuthInfo value
        re.IGNORECASE
    )
    for m in fallback.finditer(raw):
        rack, slot, port, idx, sn = m.groups()
        key = f"{rack}/{slot}/{port}:{idx}"
        if sn and sn not in ('-', 'N/A', 'n/a', 'null'):
            result[key] = sn

    return result


def _parse_remote_onu_model(raw: str) -> str:
    """
    Parse 'show gpon remote-onu model gpon-onu_<index>' output.
    Looks for: Equipment ID: <value>
    Returns model string or 'Unknown ONU'.
    """
    # Primary: Equipment ID field
    m = re.search(r"Equipment\s+ID\s*:\s*(.+)", raw, re.IGNORECASE)
    if m:
        return m.group(1).strip()

    m = re.search(r"Model\s*:\s*(.+)", raw, re.IGNORECASE)
    if m:
        return m.group(1).strip()

    # Fallback: if it's already a clean string (like from show pon uncfg table)
    # and not a large block of text, return it.
    if len(raw) < 50 and ":" not in raw:
        return raw.strip()

    return "Unknown ONU"


def _parse_pon_power(raw: str) -> tuple:
    """
    Parse 'show pon power attenuation gpon-onu_<index>' output.
    Returns (rx_dbm: float|None, tx_dbm: float|None).

    Targeting the ONU side values:
    - ONU Rx (Downstream) from the 'down' line
    - ONU Tx (Upstream) from the 'up' line
    """
    rx = None
    tx = None

    # Strategy: Look for 'up' line for Tx and 'down' line for Rx
    # Example:
    # up      Rx :-21.090(dbm)      Tx:2.286(dbm)        23.376(dB)
    # down    Tx :8.099(dbm)        Rx:-15.802(dbm)      23.901(dB)

    # ONU Tx (from 'up' line)
    up_match = re.search(r"up\s+.*?Tx\s*:\s*([-\d.]+)", raw, re.IGNORECASE | re.DOTALL)
    if up_match:
        try:
            tx = round(float(up_match.group(1)), 2)
        except ValueError:
            pass

    # ONU Rx (from 'down' line)
    down_match = re.search(r"down\s+.*?Rx\s*:\s*([-\d.]+)", raw, re.IGNORECASE | re.DOTALL)
    if down_match:
        try:
            rx = round(float(down_match.group(1)), 2)
        except ValueError:
            pass

    # Fallback for older/different formats if specific lines not found
    if rx is None:
        # Match the LAST Rx found, usually the ONU side in many ZTE versions
        rx_matches = re.findall(r"Rx\s*:\s*([-\d.]+)", raw, re.IGNORECASE)
        if rx_matches:
            rx = round(float(rx_matches[-1]), 2)

    if tx is None:
        # Match the FIRST Tx found, usually the ONU side in the 'up' row
        tx_matches = re.findall(r"Tx\s*:\s*([-\d.]+)", raw, re.IGNORECASE)
        if tx_matches:
            tx = round(float(tx_matches[0]), 2)

    return rx, tx


def _enrich_single_onu(onu: dict, profile) -> dict:
    """Enrich ONU data — stripped for overhaul."""
    return onu

def _parse_zte_power_attenuation(output):
    """
    Parses 'show pon power attenuation' output for ZTE.
    Returns (rx, tx) where rx is ONU Rx (downstream) and tx is ONU Tx (upstream).
    """
    return None, None

def _parse_onu_wan_ip_output(output: str) -> dict:
    """
    Parses the output of 'show gpon remote-onu wan-ip gpon-onu_<shelf>/<slot>/<port>:<onu-id>'
    Returns a dict with keys: status, mode, username, password, current_ip, hostname
    """
    res = {
        "status": "Unconfigured",
        "mode": None,
        "username": None,
        "password": None,
        "current_ip": None,
        "hostname": None
    }
    if not output:
        return res
        
    # Check for negative responses
    if "%Code 64040-" in output or "No relate information" in output:
        return res

    for line in output.splitlines():
        line = line.strip()
        if not line or ":" not in line:
            continue
        
        parts = line.split(":", 1)
        key = parts[0].strip().lower()
        val = parts[1].strip()
        
        if key == "mode":
            res["mode"] = val
        elif key == "username":
            res["username"] = val
        elif key == "password":
            res["password"] = val
        elif key == "status":
            if val.lower() == "connected":
                res["status"] = "Online"
        elif key in ("current ip", "current_ip"):
            res["current_ip"] = val
        elif key in ("host name", "hostname"):
            res["hostname"] = val
            
    return res

def _fetch_onu_wan_status_telnet(ip, user, pwd, en, onu_index, olt_type="c320"):
    """Legacy hardware helper — stripped for overhaul."""
    return {
        "status": "overhaul",
        "optical_power": -99,
        "traffic_up": 0,
        "traffic_down": 0,
        "wan_ip": "0.0.0.0"
    }

def _persist_onu_ip_to_db(onu_index, raw_output):
    pass

def _clear_onu_ip_from_db(onu_index):
    pass

class ONUUnconfiguredEditRequest(BaseModel):
    id: str
    name: str
    description: str

@app.post("/api/onus/unconfigured/edit")
async def edit_unconfigured_onu(req: ONUUnconfiguredEditRequest, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """
    Edits Name and Description of an Unconfigured ONU via SNMP (C3xx).
    OID BASE: 1.3.6.1.4.1.3902.1082.500.10.2.3.3.1
    Name OID: .2.$PORT.$ONUID
    Desc OID: .3.$PORT.$ONUID
    """
    if current_user["role"] == "guest":
        raise HTTPException(status_code=403, detail="Guest accounts cannot edit ONUs")

    # 1. Validation
    name = req.name.strip()
    desc = req.description.strip()
    
    # Name: 1-127 characters, all types allowed
    if not (1 <= len(name) <= 127):
        raise HTTPException(status_code=400, detail="Name must be 1-127 characters")
        
    # Desc: 1-200 characters, all types allowed
    if not (1 <= len(desc) <= 200):
        raise HTTPException(status_code=400, detail="Description must be 1-200 characters")

    # 2. Get ONU from DB
    try:
        db_id = int(req.id.split("_")[-1])
    except ValueError:
        try:
            db_id = int(req.id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid ONU ID format")
            
    onu = db.query(UnconfiguredONU).filter(UnconfiguredONU.id == db_id).first()
    if not onu:
        raise HTTPException(status_code=404, detail="ONU not found in discovery table")
    
    if not onu.index_suffix:
        raise HTTPException(status_code=400, detail="ONU missing hardware index suffix. Please refresh.")

    # 3. SNMP Set
    from sync_agent import agent
    active_ip = agent.active_ip
    if not active_ip:
        raise HTTPException(status_code=400, detail="No active OLT connection")
        
    # Get OLT profile to get community
    profile = db.query(OLTProfileDB).filter(OLTProfileDB.in_band_ip == active_ip).first()
    if not profile:
        raise HTTPException(status_code=400, detail="OLT profile not found")
    
    community = profile.snmp_community or "public"
    base_oid = "1.3.6.1.4.1.3902.1082.500.10.2.3.3.1"
    
    # Multi-set: Name and Description
    oid_vals = [
        (f"{base_oid}.2.{onu.index_suffix}", name, "str"),
        (f"{base_oid}.3.{onu.index_suffix}", desc, "str")
    ]
    
    logger.info(f"[EDIT-SNMP] Setting Name='{name}' and Desc='{desc}' for {onu.serial_number} at {active_ip}")
    success = await snmp.async_snmp_set_multi(active_ip, community, oid_vals)
    
    if not success:
        raise HTTPException(status_code=500, detail="SNMP Set operation failed on OLT hardware")

    # 4. Update DB
    onu.name = name
    onu.description = desc
    db.commit()
    
    return {"status": "success", "message": "ONU updated successfully"}

@app.post("/api/onus/{onu_index:path}/verify-wan")
def verify_onu_wan_ip(onu_index: str, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Runs 'show gpon remote-onu wan-ip gpon-onu_{shelf}/{slot}/{port}:{onu_id}' via Telnet and updates DB."""
    import urllib.parse
    decoded_index = urllib.parse.unquote(onu_index)
    
    if ":" not in decoded_index:
        raise HTTPException(status_code=400, detail="Invalid onu_index format. Expected shelf/slot/port:onu_id")
        
    pon_part, onu_id_str = decoded_index.split(":")
    pon_parts = pon_part.split("/")
    if len(pon_parts) != 3:
        raise HTTPException(status_code=400, detail="Invalid pon_index format. Expected shelf/slot/port")
        
    shelf, slot, port = pon_parts
    
    profile = _get_active_profile(db)
    if not profile:
        raise HTTPException(status_code=400, detail="No active OLT profile configured")
        
    decrypted_pwd = decrypt_password(profile.password, db) if profile.password else "zte"
    decrypted_enable = decrypt_password(profile.enable_password, db) if profile.enable_password else "zxr10"
    
    _, onu_prefix = _get_if_prefixes(profile.olt_type)
    verify_cmd = f"show gpon remote-onu wan-ip {onu_prefix}{shelf}/{slot}/{port}:{onu_id_str}"
    logger.info(f"[TELNET-VERIFICATION-MANUAL] Running: {verify_cmd}")
    
    verify_out = _run_telnet_command(
        ip=profile.in_band_ip,
        user=profile.username,
        password=decrypted_pwd,
        enable_pwd=decrypted_enable,
        command=verify_cmd,
        onu_index=decoded_index,
        port=profile.telnet_port or 23
    )
    
    if not verify_out:
        raise HTTPException(status_code=500, detail="Telnet command execution failed or timed out")
        
    parsed = _parse_onu_wan_ip_output(verify_out)
    mode_val = parsed.get("mode")
    ip_val = parsed.get("current_ip")
    user_val = parsed.get("username")
    host_val = parsed.get("hostname")
    status_val = parsed.get("status")
    
    unconf = db.query(UnconfiguredONU).filter(UnconfiguredONU.pon_index == decoded_index).first()
    if unconf:
        if mode_val:
            unconf.mode = mode_val
        if ip_val:
            unconf.wan_ip = ip_val
        if user_val:
            unconf.wan_username = user_val
        if host_val:
            unconf.wan_hostname = host_val
        if status_val:
            unconf.status = status_val
        
        try:
            db.commit()
        except Exception as e:
            db.rollback()
            logger.warning(f"[VERIFY-WAN] DB commit failed (likely StaleDataError), retrying: {e}")
            unconf_retry = db.query(UnconfiguredONU).filter(UnconfiguredONU.pon_index == decoded_index).first()
            if unconf_retry:
                if mode_val: unconf_retry.mode = mode_val
                if ip_val: unconf_retry.wan_ip = ip_val
                if user_val: unconf_retry.wan_username = user_val
                if host_val: unconf_retry.wan_hostname = host_val
                if status_val: unconf_retry.status = status_val
                try:
                    db.commit()
                except Exception as e2:
                    db.rollback()
                    logger.error(f"[VERIFY-WAN] Retry DB commit failed: {e2}")
        
    return {
        "status": "success",
        "output": verify_out,
        "mode": mode_val,
        "wan_ip": ip_val,
        "username": user_val,
        "hostname": host_val,
        "onu_status": status_val
    }

@app.get("/api/onus/{onu_index:path}/live")
def get_onu_live_status(onu_index: str, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Live status check — query database for the specified ONU."""
    import urllib.parse
    from models_db import ConfiguredONU, UnconfiguredONU, ONUPowerHistory
    decoded_index = urllib.parse.unquote(onu_index)
    
    # Query from UnconfiguredONU or ConfiguredONU
    onu = db.query(ConfiguredONU).filter(ConfiguredONU.pon_index == decoded_index).first()
    if not onu:
        onu = db.query(UnconfiguredONU).filter(UnconfiguredONU.pon_index == decoded_index).order_by(UnconfiguredONU.last_seen.desc()).first()
    
    status_val = "online"
    wan_ip_val = "-"
    rx_val = -99
    tx_val = -99
    
    if onu:
        status_val = onu.status.lower() if onu.status else "online"
        wan_ip_val = getattr(onu, "wan_ip", "-") or "-"
        
        # Get latest power history
        if onu.serial_number:
            latest_power = db.query(ONUPowerHistory).filter(ONUPowerHistory.serial_number == onu.serial_number).order_by(ONUPowerHistory.timestamp.desc()).first()
            if latest_power:
                rx_val = latest_power.rx_power if latest_power.rx_power is not None else -99
                tx_val = latest_power.tx_power if latest_power.tx_power is not None else -99
        
    return {
        "status": status_val,
        "traffic_up": 0,
        "traffic_down": 0,
        "wan_ip": wan_ip_val,
        "rx": rx_val,
        "tx": tx_val
    }

@app.get("/api/onus/{sn}/performance")
def get_onu_performance(sn: str, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Fetch Rx/Tx performance history for a specific ONU (by SN)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database not available")
        
    import datetime
    from models_db import ONUPowerHistory, OLTProfileDB, get_gmt7_time
    
    # Hanya tampilkan data mulai dari jam 00:00:00 hari ini (GMT+7)
    now = get_gmt7_time()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    history = db.query(ONUPowerHistory).filter(
        ONUPowerHistory.serial_number == sn,
        ONUPowerHistory.timestamp >= today_start
    ).order_by(ONUPowerHistory.timestamp.asc()).all()
    
    # Map OLT IPs to OLT Types (c3xx or c6xx)
    olt_profiles = db.query(OLTProfileDB).all()
    olt_type_map = {profile.in_band_ip: profile.olt_type for profile in olt_profiles}
    
    result = []
    for entry in history:
        # DB already stores GMT+7, so no adjustment needed
        local_time = entry.timestamp
        olt_type = olt_type_map.get(entry.olt_ip, "unknown")
        result.append({
            "time": local_time.strftime("%H:%M"),
            "rx": entry.rx_power,
            "tx": entry.tx_power,
            "temp": entry.temperature,
            "olt_type": olt_type
        })
        
    return result

@app.get("/api/onus/{onu_index:path}/logs")
def get_onu_logs(onu_index: str, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Fetch CLI command history for a specific ONU."""
    import urllib.parse
    decoded_index = urllib.parse.unquote(onu_index)
    
    if db is None:
        raise HTTPException(status_code=503, detail="Database not available")
    
    logs = db.query(ONUCLILog).filter(
        ONUCLILog.onu_index == decoded_index
    ).order_by(ONUCLILog.timestamp.desc()).limit(100).all()
    
    return [
        {
            "timestamp": l.timestamp.isoformat(),
            "command": l.command,
            "output": l.output
        }
        for l in logs
    ]

# Background discovery loop removed by user request (on-demand only).

async def _fetch_c6xx_unregistered_snmp(db: Session, ip: str, hw_backup: dict = None):
    """
    Background-safe helper to fetch unregistered ONUs from ZTE C6xx via SNMP.
    Pulls SN, Model, SW, and HW Version in parallel.
    """
    # 1. Get profile for community
    profile = db.query(OLTProfileDB).filter(OLTProfileDB.in_band_ip == ip).first()
    if not profile:
        return

    community = profile.snmp_community or "public"
    
    # 2. Parallel Walks for Unregistered table
    # .2 = SN, .8 = Model, .10 = SW Version, .11 = HW Version
    base = "1.3.6.1.4.1.3902.1082.500.2.2.11.2.1"
    oids = [f"{base}.2", f"{base}.8", f"{base}.10", f"{base}.11"]
    
    try:
        logger.info(f"[DISCOVERY-C6XX] Starting parallel walks for {ip} on {oids}")
        tasks = [snmp.async_snmp_bulkwalk(ip, community, oid, timeout=3) for oid in oids]
        walk_results = await asyncio.gather(*tasks)
        sn_map = walk_results[0]
        model_map = walk_results[1]
        sw_map = walk_results[2]
        hw_map = walk_results[3]
        
        logger.info(f"[DISCOVERY-C6XX] Walk results for {ip}: SN={len(sn_map)}, Model={len(model_map)}, SW={len(sw_map)}, HW={len(hw_map)}")
        
        # 3. Process and group results by index suffix
        unregistered = {}
        for full_oid, raw_sn in sn_map.items():
            suffix = snmp.extract_oid_suffix(full_oid, f"{base}.2")
            if suffix:
                unregistered[suffix] = {
                    "sn": snmp.decode_zte_sn(raw_sn),
                    "model": "-",
                    "sw": "-",
                    "hw": "-"
                }
        
        for full_oid, raw_model in model_map.items():
            suffix = snmp.extract_oid_suffix(full_oid, f"{base}.8")
            if suffix in unregistered:
                unregistered[suffix]["model"] = snmp.decode_snmp_ascii(raw_model)
                
        for full_oid, raw_sw in sw_map.items():
            suffix = snmp.extract_oid_suffix(full_oid, f"{base}.10")
            if suffix in unregistered:
                unregistered[suffix]["sw"] = snmp.decode_snmp_ascii(raw_sw)

        for full_oid, raw_hw in hw_map.items():
            suffix = snmp.extract_oid_suffix(full_oid, f"{base}.11")
            if suffix in unregistered:
                unregistered[suffix]["hw"] = snmp.decode_snmp_ascii(raw_hw)
                
        # 4. Fetch existing unregistered entries to implement 3-day retention
        existing_unreg = db.query(UnregisteredONU).filter(UnregisteredONU.olt_ip == ip).all()
        existing_unreg_map = {u.serial_number: u for u in existing_unreg}
        
        # Clean old entries
        db.query(UnregisteredONU).filter(UnregisteredONU.olt_ip == ip).delete()
        
        active_sns = set()
        
        # 5. Insert fresh results
        for suffix, data in unregistered.items():
            idx_info = snmp.decode_onu_index(suffix)
            if not idx_info: continue
            
            # Format: shelf/slot/port
            pon_index = f"{idx_info['shelf']}/{idx_info['slot']}/{idx_info['port']}"
            
            # Hardware Info Enrichment from backup if SNMP was missing it
            model = data["model"]
            sw = data["sw"]
            hw = data["hw"]
            if (model == "-" or sw == "-") and hw_backup and data["sn"] in hw_backup:
                if model == "-": model = hw_backup[data["sn"]].get("type", "-")
                if sw == "-": sw = hw_backup[data["sn"]].get("sw", "-")

            active_sns.add(data["sn"])
            db.add(UnregisteredONU(
                serial_number=data["sn"],
                equipment_id=model,
                software_version=sw,
                hw_version=hw,
                pon_index=pon_index,
                olt_ip=ip,
                last_seen=datetime.utcnow()
            ))
            
        # Clean up stale records from UnconfiguredONU table for SNs now detected as unregistered
        if active_sns:
            stale_count = db.query(UnconfiguredONU).filter(
                UnconfiguredONU.olt_ip == ip,
                UnconfiguredONU.serial_number.in_(active_sns)
            ).delete(synchronize_session=False)
            if stale_count:
                logger.info(f"[DISCOVERY-C6XX] Cleaned {stale_count} stale UnconfiguredONU records for unregistered SNs on {ip}")

        db.commit()
        logger.info(f"[DISCOVERY-C6XX] C6xx unregistered complete for {ip}. Total stored: {len(unregistered)}")
        
    except Exception as e:
        logger.error(f"[DISCOVERY-C6XX ERROR] Failed to fetch C6xx unregistered for {ip}: {e}")

async def _fetch_c3xx_unregistered_snmp(db: Session, ip: str, hw_backup: dict = None):
    """
    Background-safe helper to fetch unregistered ONUs from ZTE C3xx via SNMP.
    Pulls SN, Model, and SW Version in parallel.
    """
    # 1. Get profile for community
    profile = db.query(OLTProfileDB).filter(OLTProfileDB.in_band_ip == ip).first()
    if not profile:
        return

    community = profile.snmp_community or "public"
    
    # 2. Parallel Walks for Unconfigured table
    # .2 = SN, .7 = Model, .8 = SW Version
    base = "1.3.6.1.4.1.3902.1082.500.10.2.2.5.1"
    oids = [f"{base}.2", f"{base}.7", f"{base}.8"]
    
    try:
        logger.info(f"[DISCOVERY] Starting parallel walks for {ip} on {oids}")
        tasks = [snmp.async_snmp_bulkwalk(ip, community, oid, timeout=3) for oid in oids]
        walk_results = await asyncio.gather(*tasks)
        sn_map = walk_results[0]
        model_map = walk_results[1]
        sw_map = walk_results[2]
        
        logger.info(f"[DISCOVERY] Walk results for {ip}: SN={len(sn_map)}, Model={len(model_map)}, SW={len(sw_map)}")
        
        # 3. Process and group results by index suffix
        unregistered = {}
        for full_oid, raw_sn in sn_map.items():
            suffix = snmp.extract_oid_suffix(full_oid, f"{base}.2")
            if suffix:
                unregistered[suffix] = {
                    "sn": snmp.decode_zte_sn(raw_sn),
                    "model": "-",
                    "sw": "-"
                }
        
        for full_oid, raw_model in model_map.items():
            suffix = snmp.extract_oid_suffix(full_oid, f"{base}.7")
            if suffix in unregistered:
                unregistered[suffix]["model"] = snmp.decode_snmp_ascii(raw_model)
                
        for full_oid, raw_sw in sw_map.items():
            suffix = snmp.extract_oid_suffix(full_oid, f"{base}.8")
            if suffix in unregistered:
                unregistered[suffix]["sw"] = snmp.decode_snmp_ascii(raw_sw)
                
        # 4. Fetch existing unregistered entries to implement 3-day retention for non-active ones
        existing_unreg = db.query(UnregisteredONU).filter(UnregisteredONU.olt_ip == ip).all()
        existing_unreg_map = {u.serial_number: u for u in existing_unreg}
        
        # Clean old entries
        db.query(UnregisteredONU).filter(UnregisteredONU.olt_ip == ip).delete()
        
        active_sns = set()
        
        # 5. Insert fresh results
        for suffix, data in unregistered.items():
            idx_info = snmp.decode_onu_index(suffix)
            if not idx_info: continue
            
            # Format: shelf/slot/port
            pon_index = f"{idx_info['shelf']}/{idx_info['slot']}/{idx_info['port']}"
            
            # Hardware Info Enrichment from backup if SNMP was missing it
            model = data["model"]
            sw = data["sw"]
            if (model == "-" or sw == "-") and hw_backup and data["sn"] in hw_backup:
                if model == "-": model = hw_backup[data["sn"]].get("type", "-")
                if sw == "-": sw = hw_backup[data["sn"]].get("sw", "-")

            active_sns.add(data["sn"])
            db.add(UnregisteredONU(
                serial_number=data["sn"],
                equipment_id=model,
                software_version=sw,
                pon_index=pon_index,
                olt_ip=ip,
                last_seen=datetime.utcnow()
            ))
            
        # Clean up stale records from UnconfiguredONU table for SNs now detected as unregistered
        if active_sns:
            stale_count = db.query(UnconfiguredONU).filter(
                UnconfiguredONU.olt_ip == ip,
                UnconfiguredONU.serial_number.in_(active_sns)
            ).delete(synchronize_session=False)
            if stale_count:
                logger.info(f"[DISCOVERY] Cleaned {stale_count} stale UnconfiguredONU records for unregistered SNs on {ip}")

        db.commit()
        logger.info(f"[DISCOVERY] C3xx unregistered complete for {ip}. Total stored: {len(unregistered)}")
        
    except Exception as e:
        logger.error(f"[DISCOVERY ERROR] Failed to fetch C3xx unregistered for {ip}: {e}")

async def _fetch_c3xx_unconfigured_snmp(db: Session, ip: str, hw_backup: dict = None):
    """
    Fetch ONUs that are configured on the OLT but not yet in service/mapped correctly.
    OIDs: .2 (Name), .3 (Desc), .18 (SN)
    Base: 1.3.6.1.4.1.3902.1082.500.10.2.3.3.1
    """
    profile = db.query(OLTProfileDB).filter(OLTProfileDB.in_band_ip == ip).first()
    if not profile: return
    community = profile.snmp_community or "public"

    # Ambil olt_type secara dinamis untuk menentukan prefix (gpon-onu_ atau gpon_onu-)
    olt_id = get_selected_olt_id(db)
    olt_type = olt_id.lower() if olt_id else "c320"
    _, onu_prefix = _get_if_prefixes(olt_type)

    base = "1.3.6.1.4.1.3902.1082.500.10.2.3.3.1"
    oids = [f"{base}.2", f"{base}.3", f"{base}.18", "1.3.6.1.4.1.3902.1082.500.10.2.3.8.1.4"]
    try:
        logger.info(f"[DISCOVERY-UNCONF] Starting walks for {ip}")
        tasks = [snmp.async_snmp_bulkwalk(ip, community, oid, timeout=3) for oid in oids]
        walk_results = await asyncio.gather(*tasks)

        name_map = walk_results[0]
        desc_map = walk_results[1]
        sn_map = walk_results[2]
        los_status_map = walk_results[3]

        # Process and group by index suffix (ifIndex.onu_id)
        unconfigured = {}
        for full_oid, raw_sn in sn_map.items():
            suffix = snmp.extract_oid_suffix(full_oid, f"{base}.18")
            if suffix:
                # Format: "1,SN"
                sn_val = decode_snmp_ascii(raw_sn)
                if "," in sn_val:
                    sn_val = sn_val.split(",")[-1].strip()
                
                unconfigured[suffix] = {
                    "sn": sn_val,
                    "name": "-",
                    "desc": "-",
                    "los_status": None
                }

        for full_oid, raw_name in name_map.items():
            suffix = snmp.extract_oid_suffix(full_oid, f"{base}.2")
            if suffix in unconfigured:
                unconfigured[suffix]["name"] = decode_snmp_ascii(raw_name)

        for full_oid, raw_desc in desc_map.items():
            suffix = snmp.extract_oid_suffix(full_oid, f"{base}.3")
            if suffix in unconfigured:
                unconfigured[suffix]["desc"] = decode_snmp_ascii(raw_desc)

        # Map Offline/LOS states from sub-oid = .4
        LOS_STATUS_MAP = {
            1: "Logging",
            2: "LOS",
            3: "SyncMib",
            5: "DyingGasp",
            6: "AuthFailed",
            7: "Offline"
        }
        for full_oid, raw_status in los_status_map.items():
            suffix = snmp.extract_oid_suffix(full_oid, "1.3.6.1.4.1.3902.1082.500.10.2.3.8.1.4")
            if suffix in unconfigured:
                try:
                    status_int = int(raw_status)
                    if status_int in LOS_STATUS_MAP:
                        unconfigured[suffix]["los_status"] = LOS_STATUS_MAP[status_int]
                except Exception as e:
                    logger.warning(f"Failed to parse LOS status for {suffix}: {e}")

        # Enrichment Lookup: Get existing hardware info from both Unregistered and current Unconfigured tables
        # to ensure info persists when status changes.
        hardware_map = hw_backup.copy() if hw_backup else {}
        
        # 1. Add current Unregistered (fresh discovery results from Step 1)
        unreg_list = db.query(UnregisteredONU).filter(UnregisteredONU.olt_ip == ip).all()
        for u in unreg_list:
            hardware_map[u.serial_number] = {"type": u.equipment_id, "sw": u.software_version, "hw": getattr(u, "hw_version", "-")}
            
        # 2. Add existing Unconfigured (to preserve what we already found)
        existing_unconf = db.query(UnconfiguredONU).filter(UnconfiguredONU.olt_ip == ip).all()
        for u in existing_unconf:
            if u.serial_number not in hardware_map or (not hardware_map[u.serial_number]["type"] and u.equipment_id):
                hardware_map[u.serial_number] = {"type": u.equipment_id, "sw": u.software_version, "hw": getattr(u, "hw_version", "-")}

        # Clean old entries but keep track of them for retention and caching
        existing_unconf_map = {u.pon_index: u for u in existing_unconf}
        db.query(UnconfiguredONU).filter(UnconfiguredONU.olt_ip == ip).delete()

        # Insert fresh
        active_pon_indexes = set()
        telnet_circuit_broken = False
        for suffix, data in unconfigured.items():
            idx_info = snmp.decode_onu_index(suffix)
            if not idx_info: continue
            
            pon_index = f"{idx_info['shelf']}/{idx_info['slot']}/{idx_info['port']}:{idx_info['onu_id']}"
            active_pon_indexes.add(pon_index)
            
            # Lookup hardware info
            hw = hardware_map.get(data["sn"], {})
            
            # Inherit previous details (name, desc, WAN parameters) as cache fallback
            existing_onu = existing_unconf_map.get(pon_index)
            final_name = data["name"]
            final_desc = data["desc"]
            if existing_onu:
                if (not final_name or final_name == "-") and existing_onu.name:
                    final_name = existing_onu.name
                if (not final_desc or final_desc == "-") and existing_onu.description:
                    final_desc = existing_onu.description

            mode_val, user_val, pwd_val, ip_val, host_val = None, None, None, None, None
            status_val = "Unconfigured"
            
            if existing_onu:
                mode_val = existing_onu.mode
                user_val = existing_onu.wan_username
                pwd_val = existing_onu.wan_password
                ip_val = existing_onu.wan_ip
                host_val = existing_onu.wan_hostname
                status_val = existing_onu.status or "Unconfigured"
            
            snmp_los_status = data.get("los_status")
            
            if telnet_circuit_broken:
                logger.info(f"[TELNET-DISCOVERY] Skipping: {onu_prefix}{pon_index} on {ip} due to previous connection limit (using cached WAN details).")
            else:
                # Run Telnet Check untuk WAN IP Info menggunakan prefix dinamis
                telnet_cmd = f"show gpon remote-onu wan-ip {onu_prefix}{pon_index}"
                logger.info(f"[TELNET-DISCOVERY] Running: {telnet_cmd} on {ip}")
                
                try:
                    if profile and profile.username:
                        # Decrypt OLT password credentials for Telnet login
                        decrypted_pwd = decrypt_password(profile.password, db) if profile.password else "zte"
                        decrypted_enable = decrypt_password(profile.enable_password, db) if profile.enable_password else "zxr10"
                        
                        # Execute telnet command synchronously using dynamically retrieved port
                        telnet_out = _run_telnet_command(
                            ip=ip,
                            user=profile.username,
                            password=decrypted_pwd,
                            enable_pwd=decrypted_enable,
                            command=telnet_cmd,
                            onu_index=pon_index,
                            port=profile.telnet_port or 23
                        )
                        
                        if telnet_out:
                            parsed = _parse_onu_wan_ip_output(telnet_out)
                            mode_val = parsed.get("mode")
                            user_val = parsed.get("username")
                            pwd_val = parsed.get("password")
                            ip_val = parsed.get("current_ip")
                            host_val = parsed.get("hostname")
                            status_val = parsed.get("status", "Unconfigured")
                        else:
                            # Connection failed or refused, trigger circuit breaker
                            logger.warning(f"[TELNET-DISCOVERY] OLT {ip} refused or timed out Telnet session. Activating Circuit Breaker.")
                            telnet_circuit_broken = True
                except Exception as te:
                    logger.error(f"[TELNET-DISCOVERY ERROR] Failed for {pon_index}: {te}")
                    telnet_circuit_broken = True
            
            # If SNMP Offline/LOS state was matched, override the status_val
            if snmp_los_status:
                logger.info(f"[DISCOVERY-UNCONF] Overriding status for {pon_index} to SNMP state: {snmp_los_status}")
                status_val = snmp_los_status

            db.add(UnconfiguredONU(
                serial_number=data["sn"],
                name=final_name,
                description=final_desc,
                status=status_val,
                equipment_id=hw.get("type") or "-",
                software_version=hw.get("sw") or "-",
                hw_version=hw.get("hw") or "-",
                pon_index=pon_index,
                olt_ip=ip,
                index_suffix=suffix,
                last_seen=datetime.utcnow(),
                mode=mode_val,
                wan_username=user_val,
                wan_password=pwd_val,
                wan_ip=ip_val,
                wan_hostname=host_val
            ))

        # 6. Retain unconfigured ONUs that were NOT seen in the current walk, if last_seen is within 3 days
        for p_idx, old_onu in existing_unconf_map.items():
            if p_idx not in active_pon_indexes:
                age = datetime.utcnow() - old_onu.last_seen
                if age.total_seconds() <= 3 * 24 * 3600:  # 3 days
                    db.add(UnconfiguredONU(
                        serial_number=old_onu.serial_number,
                        name=old_onu.name,
                        description=old_onu.description,
                        status="Offline",
                        equipment_id=old_onu.equipment_id,
                        software_version=old_onu.software_version,
                        hw_version=getattr(old_onu, "hw_version", "-"),
                        pon_index=old_onu.pon_index,
                        olt_ip=old_onu.olt_ip,
                        index_suffix=old_onu.index_suffix,
                        last_seen=old_onu.last_seen,
                        mode=old_onu.mode,
                        wan_username=old_onu.wan_username,
                        wan_password=old_onu.wan_password,
                        wan_ip=old_onu.wan_ip,
                        wan_hostname=old_onu.wan_hostname
                    ))
        db.commit()
        logger.info(f"[DISCOVERY-UNCONF] C3xx unconfigured complete for {ip}. Total stored (active + retained): {len(unconfigured) + len(existing_unconf_map) - len(active_pon_indexes)}")

    except Exception as e:
        logger.error(f"[DISCOVERY-UNCONF ERROR] {e}")

active_discoveries = set()
last_scan_times = {}

@app.get("/api/onus/details")
async def get_onu_details(refresh: bool = False, force: bool = False, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    from sync_agent import agent
    active_ip = agent.active_ip
    
    logger.info(f"[API] get_onu_details called | refresh={refresh} | force={force} | active_ip={active_ip}")

    if not active_ip:
        return []

    # Use SingleFlight to prevent concurrent discovery walks returning empty data to secondary tabs
    sf_key = f"onu_details:{active_ip}:{refresh}:{force}"

    async def _do_get_onu_details():
        # Check if we have cached unregistered/unconfigured records in the DB
        has_cached = False
        unreg_count = 0
        if active_ip:
            unreg_count = db.query(UnregisteredONU).filter(UnregisteredONU.olt_ip == active_ip).count()
            unconf_count = db.query(UnconfiguredONU).filter(UnconfiguredONU.olt_ip == active_ip).count()
            if unreg_count > 0 or unconf_count > 0:
                has_cached = True

        # Check if any cached unregistered ONU has missing info ("-" or "Unknown")
        has_incomplete_unreg = False
        if active_ip and unreg_count > 0:
            incomplete_count = db.query(UnregisteredONU).filter(
                UnregisteredONU.olt_ip == active_ip,
                (UnregisteredONU.equipment_id == "-") | 
                (UnregisteredONU.equipment_id == "Unknown") | 
                (UnregisteredONU.software_version == "-")
            ).count()
            if incomplete_count > 0:
                has_incomplete_unreg = True
                logger.info(f"[DISCOVERY] Found {incomplete_count} unregistered ONUs with incomplete details. Forcing new SNMP scan.")

        # We should run a scan if the user requested refresh OR if there are NO cached records at all in the DB
        # OR if there are cached unregistered records but some of them have incomplete details ("-")
        should_scan = refresh or (not has_cached) or has_incomplete_unreg
        
        if should_scan and active_ip:
            # Check 5-second Cooldown Cache (bypassed if force=True)
            now = time.time()
            last_time = last_scan_times.get(active_ip, 0)
            if refresh and not force and (now - last_time < 5):
                logger.info(f"[DISCOVERY] Cooldown active for {active_ip} ({int(now - last_time)}s since last successful scan). Serving cache.")
            else:
                try:
                    # 0. Backup existing hardware info from DB before it's wiped by discovery
                    # This ensures we don't lose Type/SW info when an ONU moves statuses
                    hw_backup = {}
                    
                    # Pull from Unregistered
                    old_unreg = db.query(UnregisteredONU).filter(UnregisteredONU.olt_ip == active_ip).all()
                    for u in old_unreg:
                        if u.equipment_id and u.equipment_id != "-":
                            hw_backup[u.serial_number] = {"type": u.equipment_id, "sw": u.software_version, "hw": getattr(u, "hw_version", "-")}
                        
                    # Pull from Unconfigured (Enrich backup)
                    old_unconf = db.query(UnconfiguredONU).filter(UnconfiguredONU.olt_ip == active_ip).all()
                    for u in old_unconf:
                        if u.serial_number not in hw_backup or (u.equipment_id and u.equipment_id != "-"):
                            # Prioritize valid data over placeholders
                            hw_backup[u.serial_number] = {"type": u.equipment_id, "sw": u.software_version, "hw": getattr(u, "hw_version", "-")}

                    # Detect OLT type
                    olt_id = get_selected_olt_id(db)
                    olt_type = olt_id.lower() if olt_id else "c320"

                    if "c6" in olt_type:
                        # 1. Run C6xx Unregistered discovery (passing backup)
                        await _fetch_c6xx_unregistered_snmp(db, active_ip, hw_backup)
                        # 2. Run Unconfigured discovery (passing backup) karena OID sudah sama dengan C3xx
                        await _fetch_c3xx_unconfigured_snmp(db, active_ip, hw_backup)
                    else:
                        # 1. Run Unregistered discovery (passing backup)
                        await _fetch_c3xx_unregistered_snmp(db, active_ip, hw_backup)
                        # 2. Run Unconfigured discovery (passing backup)
                        await _fetch_c3xx_unconfigured_snmp(db, active_ip, hw_backup)
                    
                    # 3. Clean up any unregistered entries that now exist in the unconfigured table to prevent duplicates
                    active_unconf_sns = [u.serial_number for u in db.query(UnconfiguredONU).filter(UnconfiguredONU.olt_ip == active_ip).all()]
                    if active_unconf_sns:
                        db.query(UnregisteredONU).filter(
                            UnregisteredONU.olt_ip == active_ip,
                            UnregisteredONU.serial_number.in_(active_unconf_sns)
                        ).delete(synchronize_session=False)
                        db.commit()
                    
                    # Successful scan -> update cooldown timestamp
                    last_scan_times[active_ip] = time.time()
                except Exception as e:
                    logger.error(f"[DISCOVERY ERROR] Discovery walk failed: {e}")
            
        combined = []
        
        # Fetch Unconfigured (Discovered via .10.2.3.3.1)
        unconfigured_db = db.query(UnconfiguredONU).filter(UnconfiguredONU.olt_ip == active_ip).all() if active_ip else []
        configured_sns = {onu.serial_number for onu in unconfigured_db if onu.serial_number}
        
        # Fetch Unregistered (Discovered via .10.2.2.5.1)
        unregistered_db = db.query(UnregisteredONU).filter(UnregisteredONU.olt_ip == active_ip).all() if active_ip else []
        
        for onu in unregistered_db:
            # Prevent any duplicate display if the ONU is already configured/unconfigured
            if onu.serial_number in configured_sns:
                continue
            try:
                parts = onu.pon_index.split("/")
                shelf = int(parts[0]) if len(parts) > 0 else 1
                slot = int(parts[1]) if len(parts) > 1 else 1
                port = int(parts[2]) if len(parts) > 2 else 1
            except Exception:
                shelf, slot, port = 1, 1, 1
                
            combined.append({
                "id": f"unreg_{onu.id}",
                "status": "unregistered",
                "oltCard": slot,
                "port": port,
                "onuNumber": 0, 
                "sn": onu.serial_number,
                "name": "-",
                "description": "-",
                "onuType": onu.equipment_id or "Unknown",
                "softwareVersion": onu.software_version or "-",
                "hardwareVersion": onu.hw_version or "-",
                "shelf": shelf
            })

        # Fetch Unconfigured (Discovered via .10.2.3.3.1)
        unconfigured_db = db.query(UnconfiguredONU).filter(UnconfiguredONU.olt_ip == active_ip).all() if active_ip else []
        for onu in unconfigured_db:
            try:
                # Format: shelf/slot/port:onu_id
                parts = onu.pon_index.replace(":", "/").split("/")
                shelf = int(parts[0]) if len(parts) > 0 else 1
                slot = int(parts[1]) if len(parts) > 1 else 1
                port = int(parts[2]) if len(parts) > 2 else 1
                onu_id = int(parts[3]) if len(parts) > 3 else 0
            except Exception:
                shelf, slot, port, onu_id = 1, 1, 1, 0

            combined.append({
                "id": f"unconf_{onu.id}",
                "status": onu.status.lower() if onu.status else "unconfigured",
                "oltCard": slot,
                "port": port,
                "onuNumber": onu_id,
                "sn": onu.serial_number,
                "name": onu.name,
                "description": onu.description,
                "onuType": onu.equipment_id or "-",
                "softwareVersion": onu.software_version or "-",
                "hardwareVersion": getattr(onu, "hw_version", "-"),
                "shelf": shelf,
                "mode": onu.mode,
                "wan_username": onu.wan_username,
                "wan_password": onu.wan_password,
                "wan_ip": onu.wan_ip,
                "wan_hostname": onu.wan_hostname
            })
            
        return combined

    return await _sf.do(sf_key, _do_get_onu_details)


# ── DELETE /api/onus ─────────────────────────────────────────────────────

async def _local_snmp_set_deletion(
    ip: str,
    community: str,
    port: int,
    shelf: int,
    slot: int,
    pon_port: int,
    onu_id: int,
    timeout: int = 15
) -> bool:
    """Dedicated async SNMP SET for C3xx ONU deletion (RowStatus destroy = 6)."""
    from pysnmp.hlapi.v3arch.asyncio import (
        SnmpEngine, CommunityData, UdpTransportTarget,
        ContextData, ObjectType, ObjectIdentity, set_cmd
    )
    from pysnmp.proto.rfc1902 import Integer
    
    translated_port = (1 << 28) | (1 << 24) | (shelf << 16) | (slot << 8) | pon_port
    base_oid = "1.3.6.1.4.1.3902.1082.500.10.2.3.3.1"
    
    # 6 is destroy in SNMP RowStatus
    var_binds = [
        ObjectType(ObjectIdentity(f"{base_oid}.50.{translated_port}.{onu_id}"), Integer(6))
    ]
    
    snmp_engine = SnmpEngine()
    try:
        (err_indication, err_status, err_index, var_binds_res) = await set_cmd(
            snmp_engine,
            CommunityData(community, mpModel=1),
            await UdpTransportTarget.create((ip, port), timeout=timeout, retries=1),
            ContextData(),
            *var_binds
        )
        if err_indication or err_status:
            logger.error(f"[SNMP DELETION ERROR] {ip} {err_indication or err_status}")
            return False
        return True
    except Exception as e:
        logger.error(f"[SNMP DELETION EXCEPTION] {ip}: {e}")
        return False
    finally:
        snmp_engine.close_dispatcher()


async def _local_snmp_set_reboot(
    ip: str,
    community: str,
    port: int,
    shelf: int,
    slot: int,
    pon_port: int,
    onu_id: int,
    timeout: int = 15
) -> bool:
    """Dedicated async SNMP SET for C3xx ONU reboot (OID = 1.3.6.1.4.1.3902.1082.500.20.2.1.10.1.1, Value = 1)."""
    from pysnmp.hlapi.v3arch.asyncio import (
        SnmpEngine, CommunityData, UdpTransportTarget,
        ContextData, ObjectType, ObjectIdentity, set_cmd
    )
    from pysnmp.proto.rfc1902 import Integer
    
    translated_port = (1 << 28) | (1 << 24) | (shelf << 16) | (slot << 8) | pon_port
    base_oid = "1.3.6.1.4.1.3902.1082.500.20.2.1.10.1.1"
    
    var_binds = [
        ObjectType(ObjectIdentity(f"{base_oid}.{translated_port}.{onu_id}"), Integer(1))
    ]
    
    snmp_engine = SnmpEngine()
    try:
        (err_indication, err_status, err_index, var_binds_res) = await set_cmd(
            snmp_engine,
            CommunityData(community, mpModel=1),
            await UdpTransportTarget.create((ip, port), timeout=timeout, retries=1),
            ContextData(),
            *var_binds
        )
        if err_indication or err_status:
            logger.error(f"[SNMP REBOOT ERROR] {ip} {err_indication or err_status}")
            return False
        return True
    except Exception as e:
        logger.error(f"[SNMP REBOOT EXCEPTION] {ip}: {e}")
        return False
    finally:
        snmp_engine.close_dispatcher()


@app.post("/api/onus/reboot")
async def reboot_onus(request: ONURebootRequest, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Reboot ONUs physically from OLT via SNMP set."""
    from sync_agent import agent
    active_ip = agent.active_ip
    if not active_ip:
        # Fallback to selected_olt_id from SystemSettings database
        olt_id = get_selected_olt_id(db)
        if olt_id:
            profile = db.query(OLTProfileDB).filter(OLTProfileDB.olt_type == olt_id).first()
            if profile and profile.in_band_ip:
                active_ip = profile.in_band_ip
                
    if not active_ip:
        raise HTTPException(status_code=400, detail="No active OLT profile selected")
        
    profile = db.query(OLTProfileDB).filter(OLTProfileDB.in_band_ip == active_ip).first()
    if not profile:
        raise HTTPException(status_code=404, detail="OLT Profile not found")
        
    community = profile.snmp_community or "public"
    snmp_port = profile.snmp_port or 161
    
    results = []
    
    for item in request.items:
        try:
            parts = item.olt_index.split('/')
            shelf = int(parts[0]) if len(parts) > 0 else 1
            slot = int(parts[1]) if len(parts) > 1 else 1
            port = int(parts[2]) if len(parts) > 2 else 1
        except Exception:
            shelf, slot, port = 1, 1, 1
            
        onu_id = item.onu_id
        
        logger.info(f"[SNMP-REBOOT] Rebooting ONU {item.sn} at {shelf}/{slot}/{port}:{onu_id} via SNMP SET on {active_ip}:{snmp_port}")
        
        success = False
        try:
            success = await _local_snmp_set_reboot(
                ip=active_ip,
                community=community,
                port=snmp_port,
                shelf=shelf,
                slot=slot,
                pon_port=port,
                onu_id=onu_id,
                timeout=10
            )
        except Exception as e:
            logger.error(f"[SNMP-REBOOT ERROR] Failed to reboot ONU: {e}")
            
        results.append({
            "internal_id": item.internal_id,
            "result_status": "rebooted" if success else "failed"
        })
        
    # Memulai background task untuk SNMP cek status setelah jeda 5 detik
    async def bg_scan():
        import asyncio
        await asyncio.sleep(5)  # Jeda 5 detik
        from database import SessionLocal
        bg_db = SessionLocal()
        try:
            await get_onu_details(refresh=True, db=bg_db, current_user=current_user)
        except Exception as e:
            logger.error(f"[SNMP-REBOOT] Background scan failed: {e}")
        finally:
            bg_db.close()
            
    import asyncio
    asyncio.create_task(bg_scan())
        
    return {"status": "success", "results": results}


@app.delete("/api/onus")
async def delete_onus(request: ONUDeleteRequest, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Delete ONUs physically from OLT and database."""
    from sync_agent import agent
    active_ip = agent.active_ip
    if not active_ip:
        # Fallback to selected_olt_id from SystemSettings database
        olt_id = get_selected_olt_id(db)
        if olt_id:
            profile = db.query(OLTProfileDB).filter(OLTProfileDB.olt_type == olt_id).first()
            if profile and profile.in_band_ip:
                active_ip = profile.in_band_ip
                
    if not active_ip:
        raise HTTPException(status_code=400, detail="No active OLT profile selected")
        
    profile = db.query(OLTProfileDB).filter(OLTProfileDB.in_band_ip == active_ip).first()
    if not profile:
        raise HTTPException(status_code=404, detail="OLT Profile not found")
        
    community = profile.snmp_community or "public"
    snmp_port = profile.snmp_port or 161
    
    results = []
    
    for item in request.items:
        try:
            parts = item.olt_index.split('/')
            shelf = int(parts[0]) if len(parts) > 0 else 1
            slot = int(parts[1]) if len(parts) > 1 else 1
            port = int(parts[2]) if len(parts) > 2 else 1
        except Exception:
            shelf, slot, port = 1, 1, 1
            
        onu_id = item.onu_id
        
        logger.info(f"[SNMP-DELETION] Deleting ONU {item.sn} at {shelf}/{slot}/{port}:{onu_id} via SNMP SET on {active_ip}:{snmp_port}")
        
        success = False
        try:
            success = await _local_snmp_set_deletion(
                ip=active_ip,
                community=community,
                port=snmp_port,
                shelf=shelf,
                slot=slot,
                pon_port=port,
                onu_id=onu_id,
                timeout=10
            )
        except Exception as exc:
            logger.error(f"[SNMP-DELETION ERROR] Failed to execute SNMP SET: {exc}")
            success = False
            
        if success:
            # Delete from SQLite database
            db.query(UnconfiguredONU).filter(
                UnconfiguredONU.olt_ip == active_ip,
                UnconfiguredONU.pon_index == f"{shelf}/{slot}/{port}:{onu_id}"
            ).delete()
            db.commit()
            
            results.append({
                "internal_id": item.internal_id,
                "result_status": "removed"
            })
            logger.info(f"[SNMP-DELETION] Successfully deleted ONU {item.sn} from database and OLT.")
        else:
            logger.error(f"[SNMP-DELETION] Failed to delete ONU {item.sn} physically via SNMP SET.")
            
    # Auto-scan unregistered ONUs directly after successful deletion
    try:
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(_fetch_c3xx_unregistered_snmp(db, active_ip))
        finally:
            loop.close()
        logger.info("[SNMP-DELETION] Automatically triggered unregistered ONU scan successfully.")
    except Exception as e:
        logger.error(f"[AUTO-DISCOVERY-AFTER-DELETE ERROR] Failed: {e}")
        
    return {"results": results}


# ── POST /api/onus/register ─────────────────────────────────────────────

async def _local_snmp_set_registration(
    ip: str,
    community: str,
    port: int,
    shelf: int,
    slot: int,
    pon_port: int,
    onu_id: int,
    sn_hex: str,
    timeout: int = 15
) -> bool:
    """Dedicated async SNMP SET for C3xx ONU registration."""
    from pysnmp.hlapi.v3arch.asyncio import (
        SnmpEngine, CommunityData, UdpTransportTarget,
        ContextData, ObjectType, ObjectIdentity, set_cmd
    )
    from pysnmp.proto.rfc1902 import Integer, OctetString
    
    translated_port = (1 << 28) | (1 << 24) | (shelf << 16) | (slot << 8) | pon_port
    base_oid = "1.3.6.1.4.1.3902.1082.500.10.2.3.3.1"
    
    var_binds = [
        ObjectType(ObjectIdentity(f"{base_oid}.1.{translated_port}.{onu_id}"), OctetString("ALL")),
        ObjectType(ObjectIdentity(f"{base_oid}.5.{translated_port}.{onu_id}"), Integer(1)),
        ObjectType(ObjectIdentity(f"{base_oid}.6.{translated_port}.{onu_id}"), OctetString(bytes.fromhex(sn_hex))),
        ObjectType(ObjectIdentity(f"{base_oid}.50.{translated_port}.{onu_id}"), Integer(4))
    ]
    
    snmp_engine = SnmpEngine()
    try:
        (err_indication, err_status, err_index, var_binds_res) = await set_cmd(
            snmp_engine,
            CommunityData(community, mpModel=1),
            await UdpTransportTarget.create((ip, port), timeout=timeout, retries=1),
            ContextData(),
            *var_binds
        )
        if err_indication or err_status:
            logger.error(f"[SNMP REGISTRATION ERROR] {ip} {err_indication or err_status}")
            return False
        return True
    except Exception as e:
        logger.error(f"[SNMP REGISTRATION EXCEPTION] {ip}: {e}")
        return False
    finally:
        snmp_engine.close_dispatcher()


@app.post("/api/onus/register")
def register_onu(request: ONURegisterRequest, db: Session = Depends(get_db)):
    """Register ONU via SNMP SET."""
    from sync_agent import agent
    active_ip = agent.active_ip
    if not active_ip:
        raise HTTPException(status_code=400, detail="No active OLT connection.")

    profile = db.query(OLTProfileDB).filter(OLTProfileDB.in_band_ip == active_ip).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Active OLT profile not found.")

    # Parse Rack, Slot, Port from olt_index (e.g. "1/1/3")
    try:
        parts = request.olt_index.split("/")
        shelf = int(parts[0]) if len(parts) > 0 else 1
        slot = int(parts[1]) if len(parts) > 1 else 1
        port = int(parts[2]) if len(parts) > 2 else 1
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid olt_index: {request.olt_index}")

    # Determine ONU ID (Gap Filling if None)
    if request.onu_id is None:
        pon_port_prefix = f"{shelf}/{slot}/{port}:"
        used_ids = set()
        
        # Check UnconfiguredONU table
        unconf_onus = db.query(UnconfiguredONU).filter(
            UnconfiguredONU.olt_ip == active_ip,
            UnconfiguredONU.pon_index.like(f"{pon_port_prefix}%")
        ).all()
        for u in unconf_onus:
            try:
                u_id = int(u.pon_index.split(":")[-1])
                used_ids.add(u_id)
            except ValueError:
                continue
                
        # Find the lowest free ID (1 to 128)
        onu_id = 1
        for i in range(1, 129):
            if i not in used_ids:
                onu_id = i
                break
    else:
        onu_id = request.onu_id

    # Translate Serial Number to SNMP Hex-STRING (Hex representation)
    sn_raw = request.sn.strip()
    if len(sn_raw) < 4:
        sn_hex = sn_raw.encode("ascii").hex().upper()
    else:
        vendor_hex = sn_raw[:4].encode("ascii", errors="ignore").hex()
        serial_hex = sn_raw[4:]
        sn_hex = (vendor_hex + serial_hex).upper()

    # Query the UnregisteredONU to get its equipment_id / type
    unreg_onu = db.query(UnregisteredONU).filter(
        UnregisteredONU.serial_number == request.sn,
        UnregisteredONU.olt_ip == active_ip
    ).first()
    onu_type = "F609"
    if unreg_onu and unreg_onu.equipment_id and unreg_onu.equipment_id != "-":
        onu_type = unreg_onu.equipment_id

    community = profile.snmp_community or "public"
    snmp_port = profile.snmp_port or 161

    logger.info(f"[SNMP-REGISTRATION] Registering ONU {request.sn} as {shelf}/{slot}/{port}:{onu_id} via SNMP SET on {active_ip}:{snmp_port}")

    # Execute async SNMP set multi in a synchronous loop wrapper
    success = False
    try:
        loop = asyncio.new_event_loop()
        try:
            success = loop.run_until_complete(
                _local_snmp_set_registration(
                    ip=active_ip,
                    community=community,
                    port=snmp_port,
                    shelf=shelf,
                    slot=slot,
                    pon_port=port,
                    onu_id=onu_id,
                    sn_hex=sn_hex,
                    timeout=15
                )
            )
        finally:
            loop.close()
    except Exception as exc:
        logger.error(f"[SNMP-REGISTRATION FATAL] Failed to execute SNMP SET: {exc}")
        success = False

    if not success:
        raise HTTPException(status_code=500, detail="SNMP SET request failed during ONU registration. Please check OLT connectivity and community string.")

    # ── Database updates on success ───────────────────────────────────────────
    pon_index = f"{shelf}/{slot}/{port}:{onu_id}"
    
    # 1. Remove from UnregisteredONU
    db.query(UnregisteredONU).filter(
        UnregisteredONU.olt_ip == active_ip,
        UnregisteredONU.serial_number == request.sn
    ).delete()

    # 2. Add or update UnconfiguredONU
    db.query(UnconfiguredONU).filter(
        UnconfiguredONU.olt_ip == active_ip,
        UnconfiguredONU.pon_index == pon_index
    ).delete()

    translated_port = (1 << 28) | (1 << 24) | (shelf << 16) | (slot << 8) | port
    index_suffix = f"{translated_port}.{onu_id}"

    # ── Proactive Verification & Enrichment ───────────────────────────────────
    name_val = "-"
    desc_val = "-"
    phase_val = "-"
    telnet_out = ""
    mode_val, user_val, pwd_val, ip_val, host_val = None, None, None, None, None

    # Fetch SNMP OIDs (.2, .3, .18)
    try:
        from snmp_manager import _async_snmp_get, decode_snmp_ascii
        loop = asyncio.new_event_loop()
        try:
            raw_name = loop.run_until_complete(_async_snmp_get(active_ip, community, f"1.3.6.1.4.1.3902.1082.500.10.2.3.3.1.2.{translated_port}.{onu_id}", snmp_port, 3))
            raw_desc = loop.run_until_complete(_async_snmp_get(active_ip, community, f"1.3.6.1.4.1.3902.1082.500.10.2.3.3.1.3.{translated_port}.{onu_id}", snmp_port, 3))
            phase_val = loop.run_until_complete(_async_snmp_get(active_ip, community, f"1.3.6.1.4.1.3902.1082.500.10.2.3.3.1.18.{translated_port}.{onu_id}", snmp_port, 3)) or "-"
            
            # Dekode murni mengikuti standar data OLT
            name_val = decode_snmp_ascii(raw_name) if raw_name else "-"
            desc_val = decode_snmp_ascii(raw_desc) if raw_desc else "-"
        finally:
            loop.close()
            
        # Log clean SNMP WALK DONE messages as requested by the user
        logger.info(f"[SNMP WALK DONE] {active_ip} oid=1.3.6.1.4.1.3902.1082.500.10.2.3.3.1.2 → 1 entries")
        logger.info(f"[SNMP WALK DONE] {active_ip} oid=1.3.6.1.4.1.3902.1082.500.10.2.3.3.1.3 → 1 entries")
        logger.info(f"[SNMP WALK DONE] {active_ip} oid=1.3.6.1.4.1.3902.1082.500.10.2.3.3.1.18 → 1 entries")
    except Exception as e:
        logger.error(f"[SNMP-VERIFICATION-ERROR] Failed to fetch OID values: {e}")

    # Fetch Telnet WAN details
    if profile and profile.username:
        # Deteksi secara dinamis gpon-onu_ (C3xx) atau gpon_onu- (C6xx)
        olt_type_str = profile.olt_type or "c320"
        _, onu_prefix = _get_if_prefixes(olt_type_str)
        
        telnet_cmd = f"show gpon remote-onu wan-ip {onu_prefix}{shelf}/{slot}/{port}:{onu_id}"
        
        # Penambahan jeda 7 detik agar data ONU & WAN IP siap terbaca di OLT
        logger.info(f"[TELNET-VERIFICATION] Waiting 7 seconds for ONU to stabilize before running telnet verification...")
        time.sleep(7)
        
        logger.info(f"[TELNET-VERIFICATION] Running command: {telnet_cmd}")
        try:
            decrypted_pwd = decrypt_password(profile.password, db) if profile.password else "zte"
            decrypted_enable = decrypt_password(profile.enable_password, db) if profile.enable_password else "zxr10"
            
            telnet_out = _run_telnet_command(
                ip=active_ip,
                user=profile.username,
                password=decrypted_pwd,
                enable_pwd=decrypted_enable,
                command=telnet_cmd,
                onu_index=pon_index,
                port=profile.telnet_port or 23
            )
            if telnet_out:
                parsed = _parse_onu_wan_ip_output(telnet_out)
                mode_val = parsed.get("mode")
                user_val = parsed.get("username")
                pwd_val = parsed.get("password")
                ip_val = parsed.get("current_ip")
                host_val = parsed.get("hostname")
        except Exception as e:
            logger.error(f"[TELNET-VERIFICATION-ERROR] Failed to run telnet verification command: {e}")

    new_unconf = UnconfiguredONU(
        serial_number=request.sn,
        name=name_val, # Menghapus fallback generator, nilai murni dari OLT
        description=desc_val,
        status="Unconfigured",
        equipment_id=onu_type,
        software_version=unreg_onu.software_version if unreg_onu else "-",
        hw_version=getattr(unreg_onu, "hw_version", "-"), # Mengamankan hw_version saat pindah status registrasi
        pon_index=pon_index,
        olt_ip=active_ip,
        index_suffix=index_suffix,
        last_seen=datetime.utcnow(),
        mode=mode_val,
        wan_username=user_val,
        wan_password=pwd_val,
        wan_ip=ip_val,
        wan_hostname=host_val
    )
    db.add(new_unconf)
    db.commit()
    db.refresh(new_unconf)

    logger.info(f"[SNMP-REGISTRATION] Successfully registered ONU {request.sn} as {pon_index} via SNMP SET.")

    return {
        "status": "success",
        "onu_id": onu_id,
        "id": new_unconf.id,
        "message": "ONU registered successfully via SNMP",
        "snmp_verification": {
            "name": name_val,
            "description": desc_val,
            "phase": phase_val
        },
        "telnet_verification": {
            "command": f"show gpon remote-onu wan-ip {onu_prefix}{shelf}/{slot}/{port}:{onu_id}",
            "output": telnet_out,
            "parsed": {
                "mode": mode_val,
                "current_ip": ip_val,
                "username": user_val,
                "hostname": host_val
            }
        }
    }


# ── ONU PROVISIONING WIZARD ENDPOINTS ──────────────────────────────────────

@app.post("/api/provisioning/onu/step1")
def provisioning_step1(req: ONUProvisioningStep1Request, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Step 1 - Custom TCONT and GEMPORT provisioning for ZTE GPON OLT C3XX and C6XX."""
    profile = _get_active_profile(db)
    if not profile:
        raise HTTPException(status_code=400, detail="No active OLT profile configured")
    
    if ":" not in req.onu_index:
        raise HTTPException(status_code=400, detail="Invalid onu_index format. Expected shelf/slot/port:onu_id")
        
    pon_part, onu_id_str = req.onu_index.split(":")
    pon_parts = pon_part.split("/")
    if len(pon_parts) != 3:
        raise HTTPException(status_code=400, detail="Invalid pon_index format inside onu_index. Expected shelf/slot/port")
        
    shelf, slot, port = pon_parts
    
    _, onu_prefix = _get_if_prefixes(profile.olt_type)
    is_c6xx = profile.olt_type and ("c6" in profile.olt_type.lower() or "c600" in profile.olt_type.lower() or "c620" in profile.olt_type.lower())
    
    if is_c6xx:
        commands = [
            "configure terminal",
            f"interface {onu_prefix}{shelf}/{slot}/{port}:{onu_id_str}",
            f"tcont {req.tcont_no} profile {req.tcont_profile}",
            f"gemport {req.gemport_no} tcont {req.tcont_no}",
            "exit"
        ]
    else:
        commands = [
            "configure terminal",
            f"interface {onu_prefix}{shelf}/{slot}/{port}:{onu_id_str}",
            f"tcont {req.tcont_no} profile {req.tcont_profile}",
            f"gemport {req.gemport_no} tcont {req.tcont_no}",
            f"service-port {req.service_port} vport {req.vport} user-vlan {req.vlan_id} transparent",
            "exit"
        ]
    
    decrypted_pwd = decrypt_password(profile.password, db) if profile.password else "zte"
    decrypted_enable = decrypt_password(profile.enable_password, db) if profile.enable_password else "zxr10"
    
    output = _run_telnet_command(
        ip=profile.in_band_ip,
        user=profile.username,
        password=decrypted_pwd,
        enable_pwd=decrypted_enable,
        command=commands,
        onu_index=req.onu_index,
        port=profile.telnet_port or 23
    )
    
    if not output:
        raise HTTPException(status_code=500, detail="Telnet command execution failed or timed out")
        
    return {"status": "success", "output": output}

@app.post("/api/provisioning/onu/step2")
def provisioning_step2(req: ONUProvisioningStep2Request, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Step 2 - Custom PPPoE and WAN provisioning for ZTE GPON OLT C3XX and C6XX."""
    profile = _get_active_profile(db)
    if not profile:
        raise HTTPException(status_code=400, detail="No active OLT profile configured")
    
    if ":" not in req.onu_index:
        raise HTTPException(status_code=400, detail="Invalid onu_index format. Expected shelf/slot/port:onu_id")
        
    pon_part, onu_id_str = req.onu_index.split(":")
    pon_parts = pon_part.split("/")
    if len(pon_parts) != 3:
        raise HTTPException(status_code=400, detail="Invalid pon_index format inside onu_index. Expected shelf/slot/port")
        
    shelf, slot, port = pon_parts
    
    protocols_str = " ".join(req.protocols) if req.protocols else "web"
    
    _, onu_prefix = _get_if_prefixes(profile.olt_type)
    is_c6xx = profile.olt_type and ("c6" in profile.olt_type.lower() or "c600" in profile.olt_type.lower() or "c620" in profile.olt_type.lower())
    
    if is_c6xx:
        if not req.service_port:
            raise HTTPException(status_code=400, detail="service_port is required for OLT C6xx")
            
        commands = [
            "configure terminal",
            f"pon-onu-mng {onu_prefix}{shelf}/{slot}/{port}:{onu_id_str}",
            f"service {req.service_name} gemport {req.gemport_no} vlan {req.vlan_id}",
            f"vlan port veip_{req.veip_name} mode transparent",
            f"wan-ip {req.wan_ip_index} ipv4 mode pppoe username {req.username} password {req.password} vlan-profile {req.vlan_profile} host {req.host}",
            f"wan {req.wan} service internet host {req.host}",
            f"security-mgmt {req.security_mgmt_num} ingress-type wan mode forward state enable protocol {protocols_str}",
            "exit",
            f"interface vport-{shelf}/{slot}/{port}.{onu_id_str}:{req.gemport_no}",
            f"service-port {req.service_port} user-vlan {req.vlan_id} vlan {req.vlan_id}",
            "exit"
        ]
    else:
        commands = [
            "configure terminal",
            f"pon-onu-mng {onu_prefix}{shelf}/{slot}/{port}:{onu_id_str}",
            f"service {req.service_name} gemport {req.gemport_no} vlan {req.vlan_id}",
            f"vlan port veip_{req.veip_name} mode transparent",
            f"wan-ip {req.wan_ip_index} mode pppoe username {req.username} password {req.password} vlan-profile {req.vlan_profile} host {req.host}",
            f"wan {req.wan} service internet host {req.host}",
            f"security-mgmt {req.security_mgmt_num} ingress-type wan mode forward state enable protocol {protocols_str}",
            "exit"
        ]
    
    decrypted_pwd = decrypt_password(profile.password, db) if profile.password else "zte"
    decrypted_enable = decrypt_password(profile.enable_password, db) if profile.enable_password else "zxr10"
    
    output = _run_telnet_command(
        ip=profile.in_band_ip,
        user=profile.username,
        password=decrypted_pwd,
        enable_pwd=decrypted_enable,
        command=commands,
        onu_index=req.onu_index,
        port=profile.telnet_port or 23
    )
    
    if not output:
        raise HTTPException(status_code=500, detail="Telnet command execution failed or timed out")
        
    unconf = db.query(UnconfiguredONU).filter(UnconfiguredONU.pon_index == req.onu_index).first()
    if unconf:
        unconf.wan_username = req.username
        unconf.wan_password = req.password
        unconf.wan_ip_index = req.wan_ip_index
        db.commit()
        
    return {"status": "success", "output": output}

@app.post("/api/provisioning/onu/step3")
def provisioning_step3(req: ONUProvisioningStep3Request, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Step 3 - Custom Wi-Fi provisioning and instant WAN IP verification for ZTE GPON OLT C3XX and C6XX."""
    profile = _get_active_profile(db)
    if not profile:
        raise HTTPException(status_code=400, detail="No active OLT profile configured")
    
    if ":" not in req.onu_index:
        raise HTTPException(status_code=400, detail="Invalid onu_index format. Expected shelf/slot/port:onu_id")
        
    pon_part, onu_id_str = req.onu_index.split(":")
    pon_parts = pon_part.split("/")
    if len(pon_parts) != 3:
        raise HTTPException(status_code=400, detail="Invalid pon_index format inside onu_index. Expected shelf/slot/port")
        
    shelf, slot, port = pon_parts
    
    _, onu_prefix = _get_if_prefixes(profile.olt_type)
    is_c6xx = profile.olt_type and ("c6" in profile.olt_type.lower() or "c600" in profile.olt_type.lower() or "c620" in profile.olt_type.lower())
    
    commands = [
        "configure terminal",
        f"pon-onu-mng {onu_prefix}{shelf}/{slot}/{port}:{onu_id_str}"
    ]
    
    for item in req.wifi_configs:
        hide_str = "enable" if item.hide else "disable"
        max_users_str = f" max-users {item.max_users}" if item.max_users is not None else ""
        commands.append(f"ssid ctrl wifi_{item.slot}/{item.port} name {item.ssid_name}{max_users_str} hide {hide_str}")
        
        if item.auth_type == "open-system":
            commands.append(f"ssid auth wep wifi_{item.slot}/{item.port} open-system")
        elif item.auth_type in ("wpa-psk", "wpa-wpa2-psk", "wpa2-psk", "wpa3-sae", "wpa2-psk/wpa3-sae"):
            if is_c6xx:
                commands.append(f"ssid auth wpa wifi_{item.slot}/{item.port} auth-algorithm {item.auth_type} key {item.passphrase or ''}")
            else:
                commands.append(f"ssid auth wpa wifi_{item.slot}/{item.port} {item.auth_type} key {item.passphrase or ''}")
            
    commands.append("exit")
    
    decrypted_pwd = decrypt_password(profile.password, db) if profile.password else "zte"
    decrypted_enable = decrypt_password(profile.enable_password, db) if profile.enable_password else "zxr10"
    
    output = _run_telnet_command(
        ip=profile.in_band_ip,
        user=profile.username,
        password=decrypted_pwd,
        enable_pwd=decrypted_enable,
        command=commands,
        onu_index=req.onu_index,
        port=profile.telnet_port or 23
    )
    
    if not output:
        raise HTTPException(status_code=500, detail="Telnet command execution failed or timed out")
        
    # Run status verification via Telnet
    verify_cmd = f"show gpon remote-onu wan-ip {onu_prefix}{shelf}/{slot}/{port}:{onu_id_str}"
    logger.info(f"[TELNET-VERIFICATION-AUTO] Running: {verify_cmd}")
    verify_out = _run_telnet_command(
        ip=profile.in_band_ip,
        user=profile.username,
        password=decrypted_pwd,
        enable_pwd=decrypted_enable,
        command=verify_cmd,
        onu_index=req.onu_index,
        port=profile.telnet_port or 23
    )
    
    status_val = "Unconfigured"
    mode_val = None
    ip_val = None
    user_val = None
    host_val = None
    
    if verify_out:
        parsed = _parse_onu_wan_ip_output(verify_out)
        status_val = parsed.get("status") or "Unconfigured"
        mode_val = parsed.get("mode")
        ip_val = parsed.get("current_ip")
        user_val = parsed.get("username")
        host_val = parsed.get("hostname")
        
    unconf = db.query(UnconfiguredONU).filter(UnconfiguredONU.pon_index == req.onu_index).first()
    if unconf:
        unconf.status = status_val
        if mode_val: unconf.mode = mode_val
        if ip_val: unconf.wan_ip = ip_val
        if user_val: unconf.wan_username = user_val
        if host_val: unconf.wan_hostname = host_val
        try:
            db.commit()
        except Exception as e:
            db.rollback()
            logger.warning(f"[STEP3-VERIFY] DB commit failed, retrying: {e}")
            unconf_retry = db.query(UnconfiguredONU).filter(UnconfiguredONU.pon_index == req.onu_index).first()
            if unconf_retry:
                unconf_retry.status = status_val
                if mode_val: unconf_retry.mode = mode_val
                if ip_val: unconf_retry.wan_ip = ip_val
                if user_val: unconf_retry.wan_username = user_val
                if host_val: unconf_retry.wan_hostname = host_val
                try:
                    db.commit()
                except Exception as e2:
                    db.rollback()
                    logger.error(f"[STEP3-VERIFY] Retry DB commit failed: {e2}")
        
    return {
        "status": "success", 
        "output": output,
        "verification": {
            "output": verify_out,
            "onu_status": status_val,
            "wan_ip": ip_val
        }
    }


# ── Entry Point ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8765,
        reload=True,
        log_level="info",
        access_log=True,
    )
