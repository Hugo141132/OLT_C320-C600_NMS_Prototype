import asyncio
import logging
import platform
import subprocess
from typing import Optional

logger = logging.getLogger(__name__)

class NetworkManager:
    def __init__(self):
        self.reader: Optional[asyncio.StreamReader] = None
        self.writer: Optional[asyncio.StreamWriter] = None
        self.connected_ip: Optional[str] = None
        self.prompt_mode: str = ">"
        self.hostname: Optional[str] = None

    async def check_ping(self, ip: str, timeout_ms: int = 4000, port: Optional[int] = None) -> bool:
        """Fast ICMP ping check via system ping command, with optional TCP fallback."""
        try:
            flag = "-n" if platform.system().lower() == "windows" else "-c"
            wait_flag = "-w" if platform.system().lower() == "windows" else "-W"
            # Linux -W is in seconds, Windows -w in ms
            wait_val = str(timeout_ms) if platform.system().lower() == "windows" else str(max(1, timeout_ms // 1000))
            
            cmd = ["ping", flag, "1", wait_flag, wait_val, ip]
            
            # Run without opening console windows
            kwargs = {}
            if platform.system().lower() == "windows":
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                kwargs["startupinfo"] = startupinfo

            loop = asyncio.get_running_loop()
            proc = await loop.run_in_executor(
                None, 
                lambda: subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **kwargs)
            )
            
            if proc.returncode == 0:
                return True
                
            # TCP Fallback if ping fails and port is provided
            if port:
                try:
                    fut = asyncio.open_connection(ip, port)
                    r, w = await asyncio.wait_for(fut, timeout=1.5)
                    w.close()
                    try:
                        await w.wait_closed()
                    except Exception:
                        pass
                    return True
                except Exception:
                    pass
                    
            return False
        except Exception as e:
            logger.error(f"Ping error for {ip}: {e}")
            return False

    async def ping_sweep(self, subnet: str) -> list[str]:
        """Sweep a subnet (e.g. 192.168.1.0/24) for active IPs using fast ping."""
        import ipaddress
        try:
            network = ipaddress.ip_network(subnet, strict=False)
        except ValueError:
            logger.error(f"Invalid subnet format: {subnet}")
            return []

        active_ips = []
        tasks = []
        
        # Don't scan network/broadcast
        ips = list(network.hosts())
        
        async def check(ip_str):
            if await self.check_ping(ip_str):
                active_ips.append(ip_str)

        # Semaphore to limit concurrent pings
        sem = asyncio.Semaphore(50)
        async def bound_check(ip_str):
            async with sem:
                await check(ip_str)

        for ip in ips:
            tasks.append(asyncio.create_task(bound_check(str(ip))))

        await asyncio.gather(*tasks)
        return active_ips

    async def connect(self, ip: str, port: int, username: str, password: str, enable_password: str, timeout: float = 15.0) -> bool:
        """Establish a simple raw TCP (Telnet-like) connection and authenticate."""
        if self.writer:
            await self.disconnect()
            
        try:
            fut = asyncio.open_connection(ip, port)
            self.reader, self.writer = await asyncio.wait_for(fut, timeout=timeout)
            self.connected_ip = ip
            
            # 1. Read until Username prompt (Increased timeout for high ports)
            out = await self._read_until([b"Username:", b"login:"], timeout=10.0)
            if not out:
                raise Exception("Did not see Username prompt")
            
            self.writer.write(f"{username}\n".encode())
            await self.writer.drain()

            # 2. Read until Password prompt
            out = await self._read_until([b"Password:"], timeout=3.0)
            self.writer.write(f"{password}\n".encode())
            await self.writer.drain()

            # 3. Read until command prompt > or #
            out_str = await self._read_until_prompt(timeout=5.0)
            
            # Extract hostname from prompt like `HOSTNAME>` or `HOSTNAME#`
            import re
            m = re.search(r'\n?([A-Za-z0-9_-]+)[>#]', out_str)
            if m:
                self.hostname = m.group(1).strip()
            else:
                self.hostname = "ZXAN" # fallback
                
            if ">" in out_str and "#" not in out_str:
                self.prompt_mode = ">"
                # Try to enter enable mode
                self.writer.write(b"enable\n")
                await self.writer.drain()
                out = await self._read_until([b"Password:"], timeout=3.0)
                if out:
                    self.writer.write(f"{enable_password}\n".encode())
                    await self.writer.drain()
                    out_str2 = await self._read_until_prompt(timeout=5.0)
                    if "#" in out_str2:
                        self.prompt_mode = "#"
            else:
                self.prompt_mode = "#"

            # Disable pagination
            if self.prompt_mode == "#":
                await self.execute_command("terminal length 0")
            
            return True
        except Exception as e:
            logger.info(f"Telnet connect error to {ip}:{port} : {e}")
            await self.disconnect()
            return False

    async def execute_command(self, cmd: str, timeout: float = 6.0) -> str:
        """Send a command and read output until the prompt."""
        if not self.writer or not self.reader:
            raise RuntimeError("Not connected")
            
        # Clear buffer
        while True:
            try:
                # fast drain
                if self.reader.at_eof():
                    break
                # Since StreamReader does not expose buffer size, we use a trick:
                fut = self.reader.read(4096)
                chunk = await asyncio.wait_for(fut, timeout=0.01)
                if not chunk: break
            except asyncio.TimeoutError:
                break
                
        self.writer.write(f"{cmd}\n".encode())
        await self.writer.drain()
        
        # Read back until prompt
        return await self._read_until_prompt(timeout=timeout)

    async def _read_until(self, matches: list[bytes], timeout: float = 5.0) -> bytes:
        """Read stream until one of the byte sequences is found."""
        if not self.reader: return b""
        collected = b""
        start_time = asyncio.get_event_loop().time()
        
        while asyncio.get_event_loop().time() - start_time < timeout:
            try:
                chunk = await asyncio.wait_for(self.reader.read(1024), timeout=1.0)
                if not chunk:
                    break
                collected += chunk
                for m in matches:
                    if m in collected:
                        return collected
            except asyncio.TimeoutError:
                continue
        return collected

    async def _read_until_prompt(self, timeout: float = 5.0) -> str:
        if not self.reader: return ""
        collected = b""
        start_time = asyncio.get_event_loop().time()
        
        while asyncio.get_event_loop().time() - start_time < timeout:
            try:
                chunk = await asyncio.wait_for(self.reader.read(4096), timeout=0.5)
                if not chunk:
                    break
                collected += chunk
                text = collected.decode("utf-8", errors="replace")
                lines = [l for l in text.splitlines() if l.strip()]
                if lines:
                    last_line = lines[-1].strip()
                    if last_line.endswith(">") or last_line.endswith("#"):
                        return text
            except asyncio.TimeoutError:
                text = collected.decode("utf-8", errors="replace")
                lines = [l for l in text.splitlines() if l.strip()]
                if lines and (lines[-1].strip().endswith(">") or lines[-1].strip().endswith("#")):
                    return text
                
        return collected.decode("utf-8", errors="replace")

    async def disconnect(self):
        if self.writer:
            self.writer.close()
            try:
                await self.writer.wait_closed()
            except Exception:
                pass
            self.writer = None
            self.reader = None
            
network_mgr = NetworkManager()
