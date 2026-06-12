import threading
import time
import logging

logger = logging.getLogger(__name__)

# Global counter for active manual operations (SNMP/Telnet)
active_manual_ops = 0
active_ops_lock = threading.Lock()

# Activity tracking (Brain-Back Standby Mode)
last_activity_time = 0

def update_activity():
    global last_activity_time
    last_activity_time = time.time()

def is_system_active(timeout=28800):
    """Check if any authenticated user has been active recently (default 8 hours)."""
    return (time.time() - last_activity_time) < timeout

def increment_manual_ops():
    global active_manual_ops
    with active_ops_lock:
        active_manual_ops += 1
    logger.info(f"[GLOBALS] Manual ops incremented: {active_manual_ops}")

def decrement_manual_ops():
    global active_manual_ops
    with active_ops_lock:
        if active_manual_ops > 0:
            active_manual_ops -= 1
    logger.info(f"[GLOBALS] Manual ops decremented: {active_manual_ops}")

def get_active_manual_ops():
    return active_manual_ops
