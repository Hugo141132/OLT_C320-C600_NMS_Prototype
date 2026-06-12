"""
Serial Port Manager for OLT Console Connections.

Handles auto-detection of USB-to-Serial adapters, serial port lifecycle,
and bidirectional byte-level I/O for interactive CLI passthrough.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Optional, Callable, Awaitable

import serial
import serial.tools.list_ports

import time

logger = logging.getLogger("olt-serial")


# Known USB-to-Serial adapter VID/PID pairs for auto-detection
KNOWN_ADAPTERS = {
    (0x067B, 0x2303): "Prolific PL2303",
    (0x10C4, 0xEA60): "CP210x",
    (0x0403, 0x6001): "FTDI FT232R",
    (0x0403, 0x6015): "FTDI FT-X",
    (0x1A86, 0x7523): "CH340",
    (0x1A86, 0x5523): "CH341",
    (0x2341, 0x0043): "Arduino Mega (Serial)",
}

# Keywords to look for in `show version-running` output to identify OLT type
# Note: Huawei/ZTE OLTs often list control cards rather than the chassis name.
OLT_VERSION_KEYWORDS: dict[str, list[str]] = {
    "c600": ["C600", "ZXA10 C600", "ZXAN C600", "SFUB", "SFUL", "SFQD"],
    "c300": ["C300", "ZXA10 C300", "ZXAN C300", "SCXN", "SCXM", "SCXL", "SCTM"],
    "c320": ["C320", "ZXA10 C320", "ZXAN C320", "SMXA"],
}


@dataclass
class PortInfo:
    """Describes a detected serial port."""
    device: str            # e.g. "COM3" or "/dev/ttyUSB0"
    description: str
    adapter_name: str      # Friendly chip name from KNOWN_ADAPTERS
    vid: Optional[int] = None
    pid: Optional[int] = None


@dataclass
class ConnectionState:
    """Tracks the current serial connection."""
    is_connected: bool = False
    port: Optional[str] = None
    baudrate: int = 9600
    olt_type: str = "c600"
    adapter_name: str = ""
    error: Optional[str] = None


class SerialManager:
    """
    Manages a single serial port connection for OLT console access.

    - `scan_ports()` finds USB-to-Serial adapters.
    - `connect()` opens the port.
    - `disconnect()` closes it.
    - `write()` sends raw bytes.
    - `read_loop()` continuously reads from serial and calls a callback.
    - `start_auto_detect()` polls for newly-plugged adapters in the background.
    """

    def __init__(self) -> None:
        self._serial: Optional[serial.Serial] = None
        self._state = ConnectionState()
        self._read_task: Optional[asyncio.Task] = None
        self._detect_task: Optional[asyncio.Task] = None
        # Multi-client broadcast: sets of callbacks instead of a single callback
        self._on_data_callbacks: list[Callable[[bytes], Awaitable[None]]] = []
        self._on_disconnect_callbacks: list[Callable[[], Awaitable[None]]] = []
        self._on_port_detected: Optional[Callable[[PortInfo], Awaitable[None]]] = None
        self._detected_ports: list[PortInfo] = []

    def add_data_callback(self, cb: Callable[[bytes], Awaitable[None]]) -> None:
        """Register a callback to receive serial output (supports multiple clients)."""
        if cb not in self._on_data_callbacks:
            self._on_data_callbacks.append(cb)

    def remove_data_callback(self, cb: Callable[[bytes], Awaitable[None]]) -> None:
        """Unregister a data callback when a client disconnects."""
        if cb in self._on_data_callbacks:
            self._on_data_callbacks.remove(cb)

    def add_disconnect_callback(self, cb: Callable[[], Awaitable[None]]) -> None:
        """Register a callback to be called when serial port disconnects."""
        if cb not in self._on_disconnect_callbacks:
            self._on_disconnect_callbacks.append(cb)

    def remove_disconnect_callback(self, cb: Callable[[], Awaitable[None]]) -> None:
        """Unregister a disconnect callback."""
        if cb in self._on_disconnect_callbacks:
            self._on_disconnect_callbacks.remove(cb)

    # ── Properties ──────────────────────────────────────────────────────

    @property
    def state(self) -> ConnectionState:
        return self._state

    @property
    def detected_ports(self) -> list[PortInfo]:
        return list(self._detected_ports)

    # ── Port Scanning ───────────────────────────────────────────────────

    def scan_ports(self) -> list[PortInfo]:
        """Scan system for USB-to-Serial adapters and return detected ports."""
        ports: list[PortInfo] = []
        for p in serial.tools.list_ports.comports():
            vid = p.vid
            pid = p.pid
            adapter = KNOWN_ADAPTERS.get((vid, pid), "") if vid and pid else ""
            # Include ports that are known adapters OR have a USB VID
            if adapter or vid:
                ports.append(PortInfo(
                    device=p.device,
                    description=p.description or p.device,
                    adapter_name=adapter or "Unknown USB-Serial",
                    vid=vid,
                    pid=pid,
                ))
        self._detected_ports = ports
        return ports

    # ── Auto-Detection Background Loop ──────────────────────────────────

    async def start_auto_detect(
        self,
        on_port_detected: Optional[Callable[[PortInfo], Awaitable[None]]] = None,
        interval: float = 2.0,
    ) -> None:
        """Start a background task that polls for new serial adapters."""
        self._on_port_detected = on_port_detected
        if self._detect_task and not self._detect_task.done():
            return  # already running
        self._detect_task = asyncio.create_task(self._detect_loop(interval))

    async def stop_auto_detect(self) -> None:
        if self._detect_task and not self._detect_task.done():
            self._detect_task.cancel()
            try:
                await self._detect_task
            except asyncio.CancelledError:
                pass

    async def _detect_loop(self, interval: float) -> None:
        known_devices: set[str] = set()
        while True:
            try:
                ports = await asyncio.get_event_loop().run_in_executor(None, self.scan_ports)
                current_devices = {p.device for p in ports}

                # Notify about newly appeared ports
                new_devices = current_devices - known_devices
                for p in ports:
                    if p.device in new_devices and self._on_port_detected:
                        logger.info(f"New serial adapter detected: {p.device} ({p.adapter_name})")
                        await self._on_port_detected(p)

                known_devices = current_devices
                await asyncio.sleep(interval)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error(f"Auto-detect error: {exc}")
                await asyncio.sleep(interval)

    # ── Connection Lifecycle ────────────────────────────────────────────

    def connect(
        self,
        port: str,
        baudrate: int = 9600,
        olt_type: str = "c600",
    ) -> ConnectionState:
        """Open a serial connection. Returns updated state."""
        if self._serial and self._serial.is_open:
            self.disconnect()

        try:
            self._serial = serial.Serial(
                port=port,
                baudrate=baudrate,
                bytesize=serial.EIGHTBITS,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_ONE,
                timeout=0.01,         # Low timeout for responsive CLI
                write_timeout=1.0,
                xonxoff=False,
                rtscts=False,
                dsrdtr=False,
            )
            
            # Flush buffers for a clean session
            self._serial.reset_input_buffer()
            self._serial.reset_output_buffer()

            # Find adapter name
            adapter_name = ""
            for p in self._detected_ports:
                if p.device == port:
                    adapter_name = p.adapter_name
                    break

            self._state = ConnectionState(
                is_connected=True,
                port=port,
                baudrate=baudrate,
                olt_type=olt_type,
                adapter_name=adapter_name,
            )
            logger.info(f"Connected to {port} @ {baudrate} baud (OLT: {olt_type})")

            # Send a carriage return to trigger the OLT prompt (ZXAN#)
            try:
                self._serial.write(b"\r")
                self._serial.flush()
            except Exception:
                pass

            return self._state

        except serial.SerialException as exc:
            self._state = ConnectionState(
                is_connected=False,
                error=str(exc),
            )
            logger.error(f"Connection failed: {exc}")
            return self._state

    def disconnect(self) -> ConnectionState:
        """Close the serial port."""
        if self._read_task and not self._read_task.done():
            self._read_task.cancel()
        
        if self._serial and self._serial.is_open:
            try:
                # Attempt graceful session close: back to user exec mode
                self._serial.write(b"\x03") # Ctrl+C / SIGINT
                self._serial.write(b"\r")
                time.sleep(0.1)
                self._serial.write(b"end\r")
                time.sleep(0.1)
                self._serial.write(b"disable\r")
                time.sleep(0.2)
                self._serial.flush()
                # Final flush and close
                self._serial.reset_input_buffer()
                self._serial.reset_output_buffer()
                self._serial.close()
            except Exception:
                pass
        
        self._serial = None
        self._state = ConnectionState(is_connected=False)
        logger.info("Serial disconnected and session reset")
        return self._state

    # ── I/O ────────────────────────────────────────────────────────────

    async def write(self, data: bytes) -> None:
        """Write raw bytes to the serial port (non-blocking via executor)."""
        if not self._serial or not self._serial.is_open:
            return
        try:
            await asyncio.get_event_loop().run_in_executor(
                None, self._serial.write, data
            )
        except serial.SerialException as exc:
            logger.error(f"Write error: {exc}")
            self.disconnect()
            for cb in list(self._on_disconnect_callbacks):
                try:
                    await cb()
                except Exception:
                    pass

    async def start_read_loop(
        self,
        on_data: Callable[[bytes], Awaitable[None]],
        on_disconnect: Optional[Callable[[], Awaitable[None]]] = None,
    ) -> None:
        """Register callbacks and ensure the background read worker is running.
        
        Safe to call multiple times (e.g. one call per connected WS tab).
        The worker is a singleton — it will NOT be restarted if already running.
        Callbacks are added to the broadcast list, not replaced.
        """
        self.add_data_callback(on_data)
        if on_disconnect:
            self.add_disconnect_callback(on_disconnect)
        # Only start the worker if it is not already running
        if not self._read_task or self._read_task.done():
            self._read_task = asyncio.create_task(self._read_worker())

    async def stop_read_loop(
        self,
        on_data: Optional[Callable[[bytes], Awaitable[None]]] = None,
        on_disconnect: Optional[Callable[[], Awaitable[None]]] = None,
    ) -> None:
        """Unregister callbacks for a disconnecting client.
        
        The background worker only stops when there are NO remaining clients.
        """
        if on_data:
            self.remove_data_callback(on_data)
        if on_disconnect:
            self.remove_disconnect_callback(on_disconnect)
        # Only cancel the worker when the last client disconnects
        if not self._on_data_callbacks:
            if self._read_task and not self._read_task.done():
                self._read_task.cancel()
                try:
                    await self._read_task
                except asyncio.CancelledError:
                    pass

    async def _read_worker(self) -> None:
        """Continuously read from serial and broadcast to all registered callbacks."""
        loop = asyncio.get_event_loop()
        while True:
            try:
                if not self._serial or not self._serial.is_open:
                    logger.warning("Serial port closed, stopping read loop")
                    for cb in list(self._on_disconnect_callbacks):
                        try:
                            await cb()
                        except Exception:
                            pass
                    break

                data = await loop.run_in_executor(None, self._blocking_read)
                if data and self._on_data_callbacks:
                    # Broadcast to all connected terminal clients
                    for cb in list(self._on_data_callbacks):
                        try:
                            await cb(data)
                        except Exception as cb_exc:
                            logger.warning(f"Data callback error (client may have disconnected): {cb_exc}")

                # Small yield to not starve the event loop
                await asyncio.sleep(0.01)

            except asyncio.CancelledError:
                break
            except serial.SerialException as exc:
                logger.error(f"Serial read error: {exc}")
                self.disconnect()
                for cb in list(self._on_disconnect_callbacks):
                    try:
                        await cb()
                    except Exception:
                        pass
                break
            except Exception as exc:
                logger.error(f"Read loop error: {exc}")
                await asyncio.sleep(0.1)

    def _blocking_read(self) -> bytes:
        """Blocking read called inside an executor."""
        if not self._serial or not self._serial.is_open:
            return b""
        # Read whatever is available (up to 4096 bytes)
        waiting = self._serial.in_waiting
        if waiting > 0:
            return self._serial.read(min(waiting, 4096))
        # If nothing waiting, do a short blocking read (timeout set on Serial)
        return self._serial.read(1)

    def _detect_olt_from_output(self, text: str) -> Optional[str]:
        """
        Parse show version output and return the detected OLT type id
        (e.g. 'c600', 'c320', 'c300'), or None if unrecognised.
        """
        text_upper = text.upper()
        for olt_id, keywords in OLT_VERSION_KEYWORDS.items():
            for kw in keywords:
                if kw.upper() in text_upper:
                    return olt_id
        return None

    async def verify_olt_type(self, expected_olt_type: str) -> Optional[str]:
        """
        Silently send `show version`, collect the response, and return the
        detected OLT type id.  Returns None if the port is unavailable or
        the output is unrecognisable.

        This must be called BEFORE start_read_loop so it can safely consume
        the serial input buffer without interfering with the live forwarding.
        """
        if not self._serial or not self._serial.is_open:
            return None

        loop = asyncio.get_event_loop()
        try:
            # Wake up the terminal in case it's asleep
            await loop.run_in_executor(None, self._serial.write, b"\r")
            await asyncio.sleep(0.3)

            # Drain any pending input first
            await loop.run_in_executor(None, self._serial.reset_input_buffer)

            # Send a more specific command to avoid "Ambiguous command" error
            await loop.run_in_executor(None, self._serial.write, b"show version-running\r")

            # Collect output for up to 3 seconds
            deadline = time.monotonic() + 3.0
            collected = b""
            while time.monotonic() < deadline:
                chunk = await loop.run_in_executor(None, self._blocking_read)
                if chunk:
                    collected += chunk
                    text = collected.decode("utf-8", errors="replace")
                    detected = self._detect_olt_from_output(text)
                    if detected:
                        logger.info(f"Hardware verification: detected={detected}, expected={expected_olt_type}")
                        # Flush remaining input
                        await asyncio.sleep(0.1)
                        await loop.run_in_executor(None, self._serial.reset_input_buffer)
                        return detected
                else:
                    # Give CPU a brief rest if no data
                    await asyncio.sleep(0.05)

            # If we fall through the while loop, we didn't find the keyword
            text = collected.decode("utf-8", errors="replace")
            logger.warning(f"Hardware verification: no recognisable OLT keyword in show version output.\nRaw output received:\n{repr(text)}")
            await loop.run_in_executor(None, self._serial.reset_input_buffer)
            return None
        except Exception as exc:
            logger.error(f"verify_olt_type error: {exc}")
            return None

    async def probe_olt_discovery(self) -> dict:
        """
        Query the OLT for its configuration using show commands and capture:
        - Hostname (from prompt)
        - Telnet Port (from show telnet server)
        - Registered Usernames (from show user-config)
        """
        if not self._serial or not self._serial.is_open:
            return {"error": "Serial port not connected"}

        import re
        loop = asyncio.get_event_loop()
        results = {
            "hostname": None,
            "telnet_port": None,
            "usernames": [],
            "error": None
        }

        try:
            # 1. Wake up and enter enable mode if needed
            await loop.run_in_executor(None, self._serial.write, b"\r")
            await asyncio.sleep(0.3)
            
            # Read prompt to check state and get hostname
            probe = await loop.run_in_executor(None, self._blocking_read)
            probe_text = probe.decode("utf-8", errors="replace")
            
            # Initial hostname capture from prompt
            # Matches strings like "ZXAN#" or "MyOLT-1(config)#"
            m_host = re.search(r'([A-Za-z0-9_-]+)(?:\(config\))?[#>]', probe_text)
            if m_host:
                results["hostname"] = m_host.group(1).strip()

            if ">" in probe_text and "#" not in probe_text:
                # Enter enable mode
                await loop.run_in_executor(None, self._serial.write, b"enable\r")
                await asyncio.sleep(0.5)
                # Check for password prompt
                auth_probe = await loop.run_in_executor(None, self._blocking_read)
                auth_text = auth_probe.decode("utf-8", errors="replace")
                if "Password:" in auth_text:
                    await loop.run_in_executor(None, self._serial.write, b"zxr10\r")
                    await asyncio.sleep(0.5)

            # 2. Query Telnet Port
            results["telnet_port"] = None
            await loop.run_in_executor(None, self._serial.reset_input_buffer)
            await loop.run_in_executor(None, self._serial.write, b"show telnet server\r")
            
            # Collect and parse
            telnet_raw = b""
            deadline = time.monotonic() + 3.0
            while time.monotonic() < deadline:
                chunk = await loop.run_in_executor(None, self._blocking_read)
                if chunk:
                    telnet_raw += chunk
                    text = telnet_raw.decode("utf-8", errors="replace")
                    m_port = re.search(r'port is (\d+)', text)
                    if m_port:
                        results["telnet_port"] = int(m_port.group(1))
                        break
                await asyncio.sleep(0.05)

            # 3. Query Users
            await loop.run_in_executor(None, self._serial.reset_input_buffer)
            await loop.run_in_executor(None, self._serial.write, b"show user-config\r")
            
            user_raw = b""
            deadline = time.monotonic() + 4.0
            while time.monotonic() < deadline:
                chunk = await loop.run_in_executor(None, self._blocking_read)
                if chunk:
                    user_raw += chunk
                    text = user_raw.decode("utf-8", errors="replace")
                    if "#" in text: # Command finished
                        # Extract all usernames
                        usernames = re.findall(r'username\s+(\S+)', text)
                        # Filter out common junk or duplicates
                        results["usernames"] = list(dict.fromkeys([u for u in usernames if u.lower() not in ["config", "terminal"]]))
                        break
                await asyncio.sleep(0.05)
            
            # Final hostname check if not found earlier
            if not results["hostname"]:
                text = user_raw.decode("utf-8", errors="replace")
                m_host = re.search(r'([A-Za-z0-9_-]+)(?:\(config\))?[#>]', text)
                if m_host:
                    results["hostname"] = m_host.group(1).strip()
            
            # Clean up
            await loop.run_in_executor(None, self._serial.reset_input_buffer)
            return results

        except Exception as exc:
            logger.error(f"probe_olt_discovery error: {exc}")
            return {"error": str(exc)}
