"""
snmp_manager.py — SNMP v2c helper for ZTE OLT monitoring.

Provides:
  - snmp_walk()  : SNMP WALK on a subtree, returns {full_oid_str: value_str}
  - snmp_get()   : SNMP GET for a single OID
  - In-memory TTL cache per (ip, oid_root) to prevent OLT flooding
  - OID index decoder for ZTE GPON composite indexes (rack/slot/port:onu_id)
  - Raw SNMP logging to server terminal for debugging

NOTE: Uses pysnmp 7.x asyncio API (snake_case: next_cmd, get_cmd).
Wrapped in run_in_executor so it's safe to call from FastAPI sync endpoints.
"""

import asyncio
import time
import logging
import threading
from typing import Dict, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor
from globals import get_active_manual_ops

logger = logging.getLogger("snmp-manager")

# Shared executor for SNMP async operations called from sync context
_snmp_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="snmp")

# ── TTL Cache ────────────────────────────────────────────────────────────────
_snmp_cache: Dict[Tuple[str, str], Tuple[dict, float]] = {}
_snmp_cache_lock = threading.Lock()
SNMP_CACHE_TTL = 10  # seconds

def _cache_get(ip: str, oid_root: str) -> Optional[dict]:
    key = (ip, oid_root)
    with _snmp_cache_lock:
        entry = _snmp_cache.get(key)
        if entry:
            data, ts = entry
            if time.time() - ts < SNMP_CACHE_TTL:
                logger.info(f"[SNMP CACHE HIT] {ip} oid={oid_root} ({len(data)} entries)")
                return data
    return None

def _cache_set(ip: str, oid_root: str, data: dict):
    key = (ip, oid_root)
    with _snmp_cache_lock:
        _snmp_cache[key] = (data, time.time())

def snmp_cache_invalidate(ip: str):
    """Invalidate all cached SNMP data for a specific OLT IP."""
    with _snmp_cache_lock:
        keys_to_del = [k for k in _snmp_cache if k[0] == ip]
        for k in keys_to_del:
            del _snmp_cache[k]
    if keys_to_del:
        logger.info(f"[SNMP CACHE INVALIDATED] {ip} — {len(keys_to_del)} entries cleared")


# ── ZTE OID Constants ────────────────────────────────────────────────────────

OID = {
    # ONU Phase State: 1=Logging,2=LOS,3=SyncMib,4=Working,5=DyingGasp,6=AuthFailed,7=Offline
    "onu_phase_state":     "1.3.6.1.4.1.3902.1082.500.10.2.3.1.1.4",
    "onu_phase_state_c6xx":"1.3.6.1.4.1.3902.1082.500.10.2.3.1.1.4",

    # ONU Serial Number
    "onu_sn":              "1.3.6.1.4.1.3902.1082.500.10.2.3.1.1.5",
    "onu_sn_c6xx":         "1.3.6.1.4.1.3902.1082.500.10.2.3.1.1.18",

    # ONU Equipment ID (model name)
    "onu_equipment_id":    "1.3.6.1.4.1.3902.1082.500.10.2.3.1.1.1",

    # Optical Power (Rx/Tx) - Modern 1082
    "onu_rx_power":        "1.3.6.1.4.1.3902.1082.500.20.2.2.2.1.10",
    "onu_tx_power":        "1.3.6.1.4.1.3902.1082.500.20.2.2.2.1.14",
    "onu_rx_power_c6xx":   "",
    "onu_tx_power_c6xx":   "",

    # OLT Card table (Modern 1082)
    "olt_card_index":        "1.3.6.1.4.1.3902.1082.10.1.2.4.1.2",
    "olt_card_type":         "1.3.6.1.4.1.3902.1082.10.1.2.4.1.4",
    "olt_card_port":         "1.3.6.1.4.1.3902.1082.10.1.2.4.1.7",
    "olt_card_hw_ver":       "1.3.6.1.4.1.3902.1082.10.1.2.4.1.23",
    "olt_card_sw_ver_c3xx":  "1.3.6.1.4.1.3902.1082.20.30.2.2.2.1.7",
    "olt_card_status":       "1.3.6.1.4.1.3902.1082.10.1.2.4.1.5",
    "olt_card_cfg_status":   "1.3.6.1.4.1.3902.1082.10.1.2.4.1.13",

    # ONU Unconfigured (Modern 1082)
    "onu_unconfigured_sn":     "1.3.6.1.4.1.3902.1082.500.10.2.2.5.1.2",
    "onu_unconfigured_model":  "1.3.6.1.4.1.3902.1082.500.10.2.2.5.1.7",
    "onu_unconfigured_sw_ver": "1.3.6.1.4.1.3902.1082.500.10.2.2.5.1.8",

    # ONU Unregistered C6xx
    "onu_unreg_sn_c6xx":     "1.3.6.1.4.1.3902.1082.500.2.2.11.2.1.2",
    "onu_unreg_type_c6xx":   "1.3.6.1.4.1.3902.1082.500.2.2.11.2.1.8",
    "onu_unreg_sw_c6xx":     "1.3.6.1.4.1.3902.1082.500.2.2.11.2.1.10",
    "onu_unreg_hw_c6xx":     "1.3.6.1.4.1.3902.1082.500.2.2.11.2.1.11",

    # ONU Configured (Modern 1082)
    "onu_configured_name":     "1.3.6.1.4.1.3902.1082.500.10.2.3.3.1.2",
    "onu_configured_desc":     "1.3.6.1.4.1.3902.1082.500.10.2.3.3.1.3",
    "onu_configured_sn":       "1.3.6.1.4.1.3902.1082.500.10.2.3.3.1.6",

    # TCONT Profile Table
    "tcont_prof_name":     "1.3.6.1.4.1.3902.1082.500.10.2.1.2.1",
    "tcont_prof_type":     "1.3.6.1.4.1.3902.1082.500.10.2.1.2.2",
    "tcont_prof_fbw":      "1.3.6.1.4.1.3902.1082.500.10.2.1.2.3",
    "tcont_prof_abw":      "1.3.6.1.4.1.3902.1082.500.10.2.1.2.4",
    "tcont_prof_mbw":      "1.3.6.1.4.1.3902.1082.500.10.2.1.2.5",
}

ONU_PHASE_STATE_MAP = {
    0: "offline", 1: "logging", 2: "los", 3: "syncmib",
    4: "online",  5: "dying-gasp", 6: "auth-failed", 7: "offline",
}
ONU_PHASE_LABEL_MAP = {
    0: "Unknown", 1: "Logging", 2: "LOS", 3: "SyncMib",
    4: "Working", 5: "DyingGasp", 6: "AuthFailed", 7: "Offline",
}

CARD_STATUS_MAP = {
    1: "INSERVICE", 2: "STANDBY", 3: "OFFLINE", 4: "CONFIGING",
    5: "TYPEMISMATCH", 6: "HWONLINE", 7: "DISABLE", 8: "NOPOWER",
    9: "CONFIGFAILED",
}


# ── Async SNMP Walk ───────────────────────────────────────────────────────────

async def async_snmp_walk(ip: str, community: str, oid_root: str,
                            port: int = 161, timeout: int = 10,
                            yield_priority: bool = False) -> Dict[str, str]:
    """Async SNMP WALK using pysnmp 7.x API (next_cmd with snake_case)."""
    from pysnmp.hlapi.v3arch.asyncio import (
        SnmpEngine, CommunityData, UdpTransportTarget,
        ContextData, ObjectType, ObjectIdentity, walk_cmd
    )

    results: Dict[str, str] = {}
    snmp_engine = SnmpEngine()

    try:
        async for (err_indication, err_status, err_index, var_binds) in walk_cmd(
            snmp_engine,
            CommunityData(community, mpModel=1),
            await UdpTransportTarget.create((ip, port), timeout=timeout, retries=1),
            ContextData(),
            ObjectType(ObjectIdentity(oid_root)),
            lexicographicMode=False,
        ):
            # Yield priority only if explicitly requested (e.g. background monitoring)
            if yield_priority and get_active_manual_ops() > 0:
                logger.info(f"[SNMP WALK] Early exit due to manual operation priority for {ip}")
                break
            if err_indication:
                logger.error(f"[SNMP WALK ERROR] {ip} indication: {err_indication}")
                raise TimeoutError(f"SNMP Request Failed: {err_indication}")
            if err_status:
                err_msg = err_status.prettyPrint()
                logger.error(f"[SNMP WALK ERROR] {ip} status: {err_msg}")
                if "authorizationError" in err_msg or "noAccess" in err_msg:
                    raise PermissionError(f"SNMP Auth/Status Error: {err_msg}")
                else:
                    break
            
            for var_bind in var_binds:
                oid_str = str(var_bind[0])
                val_str = var_bind[1].prettyPrint()
                results[oid_str] = val_str
                # logger.info(f"[SNMP RAW] {oid_str} = {val_str}")
    finally:
        snmp_engine.close_dispatcher()

    logger.info(f"[SNMP WALK DONE] {ip} oid={oid_root} → {len(results)} entries")
    return results


async def async_snmp_bulkwalk(ip: str, community: str, oid_root: str,
                               port: int = 161, timeout: int = 15,
                               max_repetitions: int = 10,
                               yield_priority: bool = False) -> Dict[str, str]:
    """Async SNMP BULK WALK using pysnmp 7.x API (bulk_walk_cmd)."""
    from pysnmp.hlapi.v3arch.asyncio import (
        SnmpEngine, CommunityData, UdpTransportTarget,
        ContextData, ObjectType, ObjectIdentity, bulk_walk_cmd
    )

    results: Dict[str, str] = {}
    snmp_engine = SnmpEngine()

    try:
        async for (err_indication, err_status, err_index, var_binds) in bulk_walk_cmd(
            snmp_engine,
            CommunityData(community, mpModel=1),
            await UdpTransportTarget.create((ip, port), timeout=timeout, retries=1),
            ContextData(),
            0, max_repetitions,  # nonRepeaters=0, maxRepetitions=50
            ObjectType(ObjectIdentity(oid_root)),
            lexicographicMode=False,
        ):
            if yield_priority and get_active_manual_ops() > 0:
                logger.info(f"[SNMP BULK WALK] Early exit due to manual operation priority for {ip}")
                break
            if err_indication:
                logger.error(f"[SNMP BULK WALK ERROR] {ip} indication: {err_indication}")
                raise TimeoutError(f"SNMP Bulk Request Failed: {err_indication}")
            if err_status:
                err_msg = err_status.prettyPrint()
                logger.error(f"[SNMP BULK WALK ERROR] {ip} status: {err_msg}")
                break
            
            for var_bind in var_binds:
                oid_str = str(var_bind[0])
                val_str = var_bind[1].prettyPrint()
                # Ensure we are still within the requested subtree
                if not oid_str.startswith(oid_root.strip('.')):
                     continue
                results[oid_str] = val_str
                # logger.info(f"[SNMP BULK RAW] {oid_str} = {val_str}")
    finally:
        snmp_engine.close_dispatcher()

    logger.info(f"[SNMP BULK WALK DONE] {ip} oid={oid_root} → {len(results)} entries")
    return results


async def _async_snmp_get(ip: str, community: str, oid: str,
                           port: int, timeout: int) -> Optional[str]:
    """Async SNMP GET using pysnmp 7.x API."""
    from pysnmp.hlapi.v3arch.asyncio import (
        SnmpEngine, CommunityData, UdpTransportTarget,
        ContextData, ObjectType, ObjectIdentity, get_cmd
    )
    snmp_engine = SnmpEngine()
    try:
        (err_indication, err_status, err_index, var_binds) = await get_cmd(
            snmp_engine,
            CommunityData(community, mpModel=1),
            await UdpTransportTarget.create((ip, port), timeout=timeout, retries=1),
            ContextData(),
            ObjectType(ObjectIdentity(oid)),
        )
        if err_indication or err_status:
            return None
        for var_bind in var_binds:
            val = var_bind[1].prettyPrint()
            logger.info(f"[SNMP GET RAW] {var_bind[0]} = {val}")
            return val
    except Exception as exc:
        logger.error(f"[SNMP GET ERROR] {ip} oid={oid}: {exc}")
    finally:
        snmp_engine.close_dispatcher()
    return None


async def _async_snmp_set(ip: str, community: str, oid: str, val: int,
                           port: int, timeout: int) -> bool:
    """Async SNMP SET (Integer) using pysnmp 7.x API."""
    from pysnmp.hlapi.v3arch.asyncio import (
        SnmpEngine, CommunityData, UdpTransportTarget,
        ContextData, ObjectType, ObjectIdentity, set_cmd
    )
    from pysnmp.proto.rfc1902 import Integer
    snmp_engine = SnmpEngine()
    try:
        (err_indication, err_status, err_index, var_binds) = await set_cmd(
            snmp_engine,
            CommunityData(community, mpModel=1),
            await UdpTransportTarget.create((ip, port), timeout=timeout, retries=1),
            ContextData(),
            ObjectType(ObjectIdentity(oid), Integer(val)),
        )
        if err_indication or err_status:
            logger.error(f"[SNMP SET ERROR] {ip} {err_indication or err_status}")
            return False
        return True
    finally:
        snmp_engine.close_dispatcher()


async def _async_snmp_set_string(ip: str, community: str, oid: str, val: str,
                                  port: int, timeout: int) -> bool:
    """Async SNMP SET (OctetString) using pysnmp 7.x API."""
    from pysnmp.hlapi.v3arch.asyncio import (
        SnmpEngine, CommunityData, UdpTransportTarget,
        ContextData, ObjectType, ObjectIdentity, set_cmd
    )
    from pysnmp.proto.rfc1902 import OctetString
    snmp_engine = SnmpEngine()
    try:
        (err_indication, err_status, err_index, var_binds) = await set_cmd(
            snmp_engine,
            CommunityData(community, mpModel=1),
            await UdpTransportTarget.create((ip, port), timeout=timeout, retries=1),
            ContextData(),
            ObjectType(ObjectIdentity(oid), OctetString(val)),
        )
        if err_indication or err_status:
            logger.error(f"[SNMP SET STRING ERROR] {ip} {err_indication or err_status}")
            return False
        return True
    finally:
        snmp_engine.close_dispatcher()


async def _async_snmp_set_multi(ip: str, community: str, oid_vals: list,
                                port: int, timeout: int) -> bool:
    """
    Async SNMP SET (Multiple types) using pysnmp 7.x API.
    oid_vals should be list of (oid, value, type_str)
    type_str can be 'int' or 'str'
    """
    from pysnmp.hlapi.v3arch.asyncio import (
        SnmpEngine, CommunityData, UdpTransportTarget,
        ContextData, ObjectType, ObjectIdentity, set_cmd
    )
    from pysnmp.proto.rfc1902 import Integer, OctetString
    snmp_engine = SnmpEngine()
    try:
        var_binds = []
        for oid, val, t in oid_vals:
            if t == 'int':
                var_binds.append(ObjectType(ObjectIdentity(oid), Integer(int(val))))
            else:
                var_binds.append(ObjectType(ObjectIdentity(oid), OctetString(str(val))))

        (err_indication, err_status, err_index, var_binds_res) = await set_cmd(
            snmp_engine,
            CommunityData(community, mpModel=1),
            await UdpTransportTarget.create((ip, port), timeout=timeout, retries=1),
            ContextData(),
            *var_binds
        )
        if err_indication or err_status:
            logger.error(f"[SNMP SET MULTI ERROR] {ip} {err_indication or err_status}")
            return False
        return True
    finally:
        snmp_engine.close_dispatcher()


# ── Synchronous Public API (thread-safe, runs asyncio internally) ────────────

_walk_locks = {}
_walk_locks_lock = threading.Lock()

def _get_walk_lock(ip: str, oid_root: str) -> threading.Lock:
    """Helper to retrieve or create a lock for a specific OLT IP and OID combination."""
    with _walk_locks_lock:
        key = (ip, oid_root)
        if key not in _walk_locks:
            _walk_locks[key] = threading.Lock()
        return _walk_locks[key]


def snmp_walk(ip: str, community: str, oid_root: str,
              port: int = 161, timeout: int = 10,
              use_cache: bool = True, yield_priority: bool = False) -> Dict[str, str]:
    """
    Synchronous SNMP WALK — safe to call from FastAPI sync endpoints.
    Uses in-memory TTL cache. Logs all OIDs to server terminal.
    Returns {} on any error or timeout.
    """
    if not ip or not community:
        logger.warning("[SNMP WALK] Missing ip or community — skipping")
        return {}

    if use_cache:
        cached = _cache_get(ip, oid_root)
        if cached is not None:
            return cached

    # Acquire lock per IP and OID to prevent thundering herd / cache stampede
    lock = _get_walk_lock(ip, oid_root)
    with lock:
        # Double-check inside the lock in case another thread populated the cache
        if use_cache:
            cached = _cache_get(ip, oid_root)
            if cached is not None:
                return cached

        logger.info(f"[SNMP WALK] START {ip}:{port} community='{community}' oid={oid_root}")
        try:
            loop = asyncio.new_event_loop()
            try:
                results = loop.run_until_complete(
                    async_snmp_walk(ip, community, oid_root, port, timeout, yield_priority)
                )
            finally:
                loop.close()

            _cache_set(ip, oid_root, results)
            return results
        except (TimeoutError, PermissionError) as exc:
            logger.error(f"[SNMP WALK FATAL] {ip}: {exc}")
            raise exc
        except Exception as exc:
            logger.error(f"[SNMP WALK FATAL] {ip}: {exc}")
            return {}


def snmp_bulkwalk(ip: str, community: str, oid_root: str,
                  port: int = 161, timeout: int = 10,
                  max_repetitions: int = 50,
                  use_cache: bool = True, yield_priority: bool = False) -> Dict[str, str]:
    """
    Synchronous SNMP BULK WALK — safe to call from FastAPI sync endpoints.
    Uses in-memory TTL cache. Logs all OIDs to server terminal.
    """
    if not ip or not community:
        return {}

    if use_cache:
        cached = _cache_get(ip, oid_root)
        if cached is not None:
            return cached

    # Acquire lock per IP and OID to prevent thundering herd / cache stampede
    lock = _get_walk_lock(ip, oid_root)
    with lock:
        # Double-check inside the lock in case another thread populated the cache
        if use_cache:
            cached = _cache_get(ip, oid_root)
            if cached is not None:
                return cached

        logger.info(f"[SNMP BULK WALK] START {ip}:{port} community='{community}' oid={oid_root} (max_rep={max_repetitions})")
        try:
            loop = asyncio.new_event_loop()
            try:
                results = loop.run_until_complete(
                    async_snmp_bulkwalk(ip, community, oid_root, port, timeout, max_repetitions, yield_priority)
                )
            finally:
                loop.close()

            _cache_set(ip, oid_root, results)
            return results
        except (TimeoutError, PermissionError) as exc:
            logger.error(f"[SNMP BULK WALK FATAL] {ip}: {exc}")
            raise exc
        except Exception as exc:
            logger.error(f"[SNMP BULK WALK FATAL] {ip}: {exc}")
            return {}



async def async_snmp_multi_walk(ip: str, community: str, oids_dict: Dict[str, str],
                                port: int = 161, timeout: int = 20,
                                bulk: bool = False, max_repetitions: int = 50,
                                yield_priority: bool = False) -> Dict[str, Dict[str, str]]:
    """
    Run multiple SNMP walks sequentially with a small sleep to avoid flooding the OLT agent.
    Returns a dict mapping the input keys to their respective {OID: Value} results.
    """
    keys = list(oids_dict.keys())
    final_results = {}
    
    for key in keys:
        oid = oids_dict[key]
        try:
            if bulk:
                res = await async_snmp_bulkwalk(ip, community, oid, port, timeout, max_repetitions, yield_priority)
            else:
                res = await async_snmp_walk(ip, community, oid, port, timeout, yield_priority)
            final_results[key] = res
        except Exception as e:
            logger.error(f"[SNMP MULTI ERROR] Key '{key}' failed for {ip}: {e}")
            final_results[key] = {}
        # Breathe time for OLT's single-threaded SNMP agent (200ms sleep for robustness)
        await asyncio.sleep(0.2)
            
    return final_results


def snmp_multi_walk(ip: str, community: str, oids_dict: Dict[str, str],
                    port: int = 161, timeout: int = 20,
                    bulk: bool = False, max_repetitions: int = 10,
                    yield_priority: bool = False) -> Dict[str, Dict[str, str]]:
    """
    Synchronous wrapper for Parallel SNMP Fetching.
    """
    if not ip or not community or not oids_dict:
        return {}

    logger.info(f"[SNMP MULTI] START {ip} ({len(oids_dict)} tables, bulk={bulk})")
    try:
        loop = asyncio.new_event_loop()
        try:
            results = loop.run_until_complete(
                async_snmp_multi_walk(ip, community, oids_dict, port, timeout, bulk, max_repetitions, yield_priority)
            )
        finally:
            loop.close()
        return results
    except Exception as exc:
        logger.error(f"[SNMP MULTI FATAL] {ip}: {exc}")
        return {k: {} for k in oids_dict.keys()}


def snmp_get(ip: str, community: str, oid: str,
             port: int = 161, timeout: int = 5) -> Optional[str]:
    """
    Synchronous SNMP GET — safe to call from FastAPI sync endpoints.
    """
    if not ip or not community:
        return None
    logger.info(f"[SNMP GET] {ip}:{port} oid={oid}")
    try:
        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(
                _async_snmp_get(ip, community, oid, port, timeout)
            )
        finally:
            loop.close()
        return result
    except Exception as exc:
        logger.error(f"[SNMP GET FATAL] {ip}: {exc}")
        return None


def snmp_set_int(ip: str, community: str, oid: str, value: int,
                 port: int = 161, timeout: int = 15) -> bool:
    """
    Synchronous SNMP SET (Integer) — safe to call from FastAPI sync endpoints.
    """
    if not ip or not community:
        return False
    logger.info(f"[SNMP SET] {ip}:{port} oid={oid} val={value}")
    try:
        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(
                _async_snmp_set(ip, community, oid, value, port, timeout)
            )
        finally:
            loop.close()
        return result
    except Exception as exc:
        logger.error(f"[SNMP SET FATAL] {ip}: {exc}")
        return False


def snmp_set_string(ip: str, community: str, oid: str, value: str,
                    port: int = 161, timeout: int = 15) -> bool:
    """
    Synchronous SNMP SET (OctetString) — safe to call from FastAPI sync endpoints.
    """
    if not ip or not community:
        return False
    logger.info(f"[SNMP SET STRING] {ip}:{port} oid={oid} val={value}")
    try:
        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(
                _async_snmp_set_string(ip, community, oid, value, port, timeout)
            )
        finally:
            loop.close()
        return result
    except Exception as exc:
        logger.error(f"[SNMP SET STRING FATAL] {ip}: {exc}")
        return False


async def async_snmp_set_multi(ip: str, community: str, oid_vals: list,
                               port: int = 161, timeout: int = 15) -> bool:
    """
    Asynchronous SNMP SET for multiple variables of different types.
    oid_vals: [(oid, value, 'int'|'str'), ...]
    """
    if not ip or not community or not oid_vals:
        return False
    logger.info(f"[SNMP SET MULTI ASYNC] {ip}:{port} vars={len(oid_vals)}")
    try:
        return await _async_snmp_set_multi(ip, community, oid_vals, port, timeout)
    except Exception as exc:
        logger.error(f"[SNMP SET MULTI ASYNC FATAL] {ip}: {exc}")
        return False


def snmp_set_multi(ip: str, community: str, oid_vals: list,
                   port: int = 161, timeout: int = 15) -> bool:
    """
    Synchronous SNMP SET for multiple variables of different types.
    oid_vals: [(oid, value, 'int'|'str'), ...]
    """
    if not ip or not community or not oid_vals:
        return False
    logger.info(f"[SNMP SET MULTI] {ip}:{port} vars={len(oid_vals)}")
    try:
        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(
                _async_snmp_set_multi(ip, community, oid_vals, port, timeout)
            )
        finally:
            loop.close()
        return result
    except Exception as exc:
        logger.error(f"[SNMP SET MULTI FATAL] {ip}: {exc}")
        return False


def snmp_set_multi_ints(ip: str, community: str, oid_vals: list,
                       port: int = 161, timeout: int = 5) -> bool:
    """
    Synchronous SNMP SET for multiple variables, all assumed to be integers.
    oid_vals: [(oid, value), ...]
    """
    if not ip or not community or not oid_vals:
        return False
    # Transform [(oid, val), ...] to [(oid, val, 'int'), ...]
    typed_vals = [(oid, val, 'int') for oid, val in oid_vals]
    return snmp_set_multi(ip, community, typed_vals, port, timeout)


# ── OID Index Decoders ────────────────────────────────────────────────────────

def extract_oid_suffix(full_oid: str, base_oid: str) -> str:
    """Return the suffix of full_oid after base_oid, ignoring leading dots."""
    base = base_oid.strip(".")
    full = full_oid.strip(".")
    if full.startswith(base):
        return full[len(base):].lstrip(".")
    return full


def string_to_oid_suffix(text: str) -> str:
    """
    Converts a string to SNMP index suffix: length.ascii1.ascii2...
    Example: 'TEST' -> '4.84.69.83.84'
    """
    if not text:
        return "0"
    length = len(text)
    ascii_vals = [str(ord(c)) for c in text]
    return f"{length}.{'.'.join(ascii_vals)}"

def decode_oid_ascii_suffix(suffix: str) -> str:
    """
    Decodes an OID suffix where the first number is length and the rest are ASCII values.
    Example: '4.84.69.83.84' -> 'TEST'
    """
    try:
        parts = suffix.strip('.').split('.')
        chars = [chr(int(x)) for x in parts[1:]]
        return "".join(chars)
    except Exception:
        return suffix


def decode_onu_index(suffix: str) -> Optional[dict]:
    """
    Decode ZTE composite OID suffix into rack/shelf/slot/port/onu_id.
    Handles multiple formats:
    1. 5 parts: rack.shelf.slot.port.onu_id
    2. 4 parts: shelf.slot.port.onu_id (or rack.slot.port.onu_id)
    3. 2 parts: ifIndex.onu_id (bitwise decode)
    """
    try:
        parts = [int(x) for x in suffix.strip(".").split(".")]
        
        # 5 Parts: Rack.Shelf.Slot.Port.OnuId
        if len(parts) >= 5:
            r, sh, sl, p, ont = parts[-5], parts[-4], parts[-3], parts[-2], parts[-1]
            # Defensive check: On C320, if we see sh=1, sl=1, p=1 but it's shifted,
            # we ensure the returned dictionary is accurate.
            return {
                "rack": r, "shelf": sh, "slot": sl, "port": p, "onu_id": ont,
                "index_str": f"{sh}/{sl}/{p}:{ont}",
            }
            
        # 4 Parts: Often Shelf.Slot.Port.OnuId or Rack.Slot.Port.OnuId
        if len(parts) == 4:
            p1, sl, p, ont = parts
            # If Rack/Shelf is 1, index is 1/slot/port
            return {
                "rack": 1, "shelf": p1, "slot": sl, "port": p, "onu_id": ont,
                "index_str": f"{p1}/{sl}/{p}:{ont}",
            }
            
        # 3 Parts: ifIndex.instance.onu_id OR slot.port.onu_id
        if len(parts) == 3:
            if parts[0] > 1000:
                ifindex, onu_id, _ = parts
                rack  = (ifindex >> 24) & 0xF
                if rack == 0: rack = 1
                shelf = (ifindex >> 16) & 0xFF
                slot  = (ifindex >> 8) & 0xFF
                port  = ifindex & 0xFF
                return {
                    "rack": rack, "shelf": shelf, "slot": slot, "port": port, "onu_id": onu_id,
                    "index_str": f"{shelf}/{slot}/{port}:{onu_id}",
                }
            else:
                sl, p, ont = parts
                return {
                    "rack": 1, "shelf": 1, "slot": sl, "port": p, "onu_id": ont,
                    "index_str": f"1/{sl}/{p}:{ont}",
                }
            
        # 2 Parts: ifIndex.onu_id
        if len(parts) == 2:
            ifindex, onu_id = parts
            # ZTE ifIndex bits (8 bits each): Type[31:28], Rack[27:24], Shelf[23:16], Slot[15:8], Port[7:0]
            # Type 1 = GPON, 2 = EPON
            rack  = (ifindex >> 24) & 0xF
            if rack == 0: rack = 1
            shelf = (ifindex >> 16) & 0xFF
            slot  = (ifindex >> 8) & 0xFF
            port  = ifindex & 0xFF
            
            # Formatting: Shelf/Slot/Port
            return {
                "rack": rack, "shelf": shelf, "slot": slot, "port": port, "onu_id": onu_id,
                "index_str": f"{shelf}/{slot}/{port}:{onu_id}",
            }
    except (ValueError, TypeError, IndexError):
        pass
    return None

def encode_onu_index(rack: int, slot: int, port: int, onu_id: int) -> str:
    """
    Encode rack/slot/port/onu_id into ZTE composite OID suffix (ifIndex.onu_id).
    Used for most performance and state OIDs.
    """
    # ZTE PON ifIndex bitwise format:
    # [31:28] = 1 (fixed)
    # [27:24] = rack
    # [23:16] = slot
    # [15:8]  = port
    # [7:0]   = 0 (for the base ifIndex)
    ifindex = (1 << 28) | (rack << 24) | (slot << 16) | (port << 8)
    return f"{ifindex}.{onu_id}"



def decode_card_index(suffix: str) -> Optional[dict]:
    """
    Decode ZTE card OID suffix into rack/shelf/slot.
    User specifies: rack.shelf.slot (3 digits belakang)
    """
    try:
        parts = [int(x) for x in suffix.strip(".").split(".")]
        if len(parts) >= 3:
            return {"rack": parts[-3], "shelf": parts[-2], "slot": parts[-1]}
        if len(parts) == 2:
            return {"rack": 1, "shelf": parts[-2], "slot": parts[-1]}
        if len(parts) == 1:
            return {"rack": 1, "shelf": 1, "slot": parts[0]}
    except (ValueError, TypeError):
        pass
    return None


# ── Power Converter ────────────────────────────────────────────────────────────

def zte_power_to_dbm(raw_value: str) -> Optional[float]:
    """
    Convert ZTE SNMP optical power raw value to dBm.
    Formula: dBm = (value * 0.002) - 30
    Handles two's complement for negative numbers (value > 32767).
    """
    try:
        v = int(raw_value)
        # Handle 16-bit signed integer negative values
        if v >= 32768:
            v = v - 65536
            
        dbm = round((v * 0.002) - 30, 2)
        return dbm
    except (ValueError, TypeError):
        pass
    return None

def zte_rx_power_to_dbm(raw_value: str) -> Optional[float]:
    """
    Convert ZTE SNMP optical Rx power raw value to dBm for C600 and C320.
    Formula: dBm = (value * 0.002) - 30
    Handles two's complement for negative numbers (value >= 32768).
    Condition: must be in range -32 dBm to -14 dBm (inclusive), else returns None.
    """
    try:
        v = int(raw_value)
        if v == 0 or v == 65535 or v == 2147483647:
            return None
        if v >= 32768:
            v = v - 65536
            
        dbm = round((v * 0.002) - 30, 2)
        if -32.0 <= dbm <= -14.0:
            return dbm
    except (ValueError, TypeError):
        pass
    return None

def zte_tx_power_to_dbm(raw_value: str) -> Optional[float]:
    """
    Convert ZTE SNMP optical Tx power raw value to dBm for C600 and C320.
    Formula: dBm = (value * 0.002) - 30
    Handles two's complement for negative numbers (value >= 32768).
    Condition: must be in range -10 dBm to +12 dBm (inclusive), else returns None.
    """
    try:
        v = int(raw_value)
        if v == 0 or v == 65535 or v == 2147483647:
            return None
        if v >= 32768:
            v = v - 65536
            
        dbm = round((v * 0.002) - 30, 2)
        if -10.0 <= dbm <= 12.0:
            return dbm
    except (ValueError, TypeError):
        pass
    return None

def zte_c3xx_power_to_dbm(raw_value: str) -> Optional[float]:
    """
    Convert ZTE C3xx SNMP optical power (0.01 dBm units) to float dBm.
    Used for OID 1.3.6.1.4.1.3902.1082.500.20.2.2.2.1.10/14
    """
    try:
        v = int(raw_value)
        # 65535 or 2147483647 are common "no data" markers
        if v == 65535 or v == 2147483647 or v == 0:
            return None
        
        # ZTE C3xx power OIDs often use 0.01 dBm units.
        # Example: -2450 -> -24.50 dBm
        dbm = round(v / 100.0, 2)
        
        # Sanity check
        if -60.0 <= dbm <= 15.0:
            return dbm
    except (ValueError, TypeError):
        pass
    return None

def decode_zte_sn(raw_sn: str) -> str:
    """
    Decodes ZTE hex SN (e.g. 0x59454b47cbd8b9b1 or "Hex-STRING: 43 44...") to a readable string.
    ZTE GPON SN starts with 4 ASCII chars followed by 8 hex digits.
    """
    if "Hex-STRING:" in raw_sn:
        hex_parts = raw_sn.replace("Hex-STRING:", "").strip().split()
        raw_sn = "0x" + "".join(hex_parts)

    if raw_sn and raw_sn.startswith("0x"):
        try:
            hex_str = raw_sn[2:]
            if len(hex_str) >= 8:
                vendor = bytes.fromhex(hex_str[:8]).decode("ascii", errors="ignore")
                mac_or_serial = hex_str[8:].upper()
                return vendor + mac_or_serial
        except Exception:
            return raw_sn
    return raw_sn.strip('"')

def decode_snmp_ascii(raw_val: str) -> str:
    """
    Decodes SNMP hex-string (e.g. 0x54434f4e54 or "Hex-STRING: 47 43...") to ASCII string.
    If it's already a string (with STRING: or OctetString: prefix), cleans it up.
    """
    if not raw_val: return "-"
    
    # Handle Hex-STRING format
    if "Hex-STRING:" in raw_val:
        hex_parts = raw_val.replace("Hex-STRING:", "").strip().split()
        raw_val = "0x" + "".join(hex_parts)

    if raw_val.startswith("0x"):
        try:
            # Filter out null bytes and non-printable chars
            b = bytes.fromhex(raw_val[2:])
            return b.decode("ascii", errors="ignore").replace("\x00", "").strip()
        except Exception:
            return raw_val
            
    # Handle common STRING prefixes from various SNMP tools
    res = raw_val
    for prefix in ["STRING:", "OctetString:", "string:"]:
        if res.startswith(prefix):
            res = res[len(prefix):].strip()
            break
            
    return res.strip('"').strip()
