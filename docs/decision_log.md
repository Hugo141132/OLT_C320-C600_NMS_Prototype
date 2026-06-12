# OLT-WEB Project Decision Log

This Decision Log tracks architectural, structural, and operational choices made during the QC & Research OLT ZTE management system development and deployment lifecycle.

---

## [DECISION-001] Docker Network Integration (Internal DNS Resolution)

### Status
**APPROVED / IMPLEMENTED**

### Context & Problem
During the containerized deployment stage, the backend FastAPI container failed to connect to the PostgreSQL service container, raising a socket resolution error:
```
Name or service not known
```
This was caused by Docker Compose utilizing the default bridge network, which does not provide automated container name DNS resolution.

### Chosen Solution
Configure a **custom bridge network** (`olt_net`) within the `docker-compose.yml` file and assign all integrated services (`db`, `backend`, `frontend`) to this network block. This allows the backend to resolve `db` natively to the database container's IP.

```yaml
networks:
  olt_net:
    driver: bridge

services:
  db:
    ...
    networks:
      - olt_net
  backend:
    ...
    networks:
      - olt_net
  frontend:
    ...
    networks:
      - olt_net
```

### Consequences
- **Pros**: Perfectly solves internal DNS name resolution without hardcoding static container IPs or using legacy Docker links.
- **Cons**: Requires custom network declaration in Docker Compose.

---

## [DECISION-002] Next.js Proxy/Rewrite Build-Time Caching Workaround

### Status
**APPROVED / IMPLEMENTED**

### Context & Problem
The Next.js frontend proxy/rewrites failed to reach the FastAPI backend on server start, throwing an `ECONNREFUSED` error pointing to `127.0.0.1:8765`. 
This occurred because `next.config.mjs` cached rewrite configurations during the **Build Time** (`next build`). Since `BACKEND_URL` was undefined during the initial Docker image building stage, Next.js fell back to the hardcoded port `8765`.

### Chosen Solution
Incorporate `ARG BACKEND_URL` and `ENV BACKEND_URL=$BACKEND_URL` in the frontend `Dockerfile` right before the `RUN pnpm build` command. 

```dockerfile
# Copy files and build
COPY . .
ARG BACKEND_URL
ENV BACKEND_URL=$BACKEND_URL
RUN pnpm build
```

This ensures that during building, the target backend URL is baked into the statically compiled files.

### Verification Command
```powershell
docker build --build-arg BACKEND_URL=http://backend:8000 -t hugopurohita/olt-web-frontend:latest .
```

### Consequences
- **Pros**: Resolves the cached build-time proxy configurations, allowing Next.js to direct traffic to `http://backend:8000` inside the custom bridge network.
- **Cons**: The backend endpoint must be known at build time, requiring standard production arg injection.

---

## [DECISION-003] Async SNMP & Console Management Architecture

### Status
**APPROVED / ACTIVE**

### Context & Problem
OLT devices feature single-threaded CLI commands and SNMP agents. Flooding these agents with concurrent, blocking Python threads risks high latency, shell locks, or CPU spikes on local cards.

### Chosen Solution
1. **Thread-Safe SNMP Wrappers**: Standardized `ThreadPoolExecutor` and asyncio loop run-in-executors inside `backend/snmp_manager.py` to prevent blocking FastAPI’s event loop during synchronous hardware walks.
2. **Interactive Serial Passthrough**: Integrated multi-client broadcast websocket pattern in `backend/serial_manager.py` using non-blocking read workers and low-latency thread sleep hooks.

### Consequences
- **Pros**: Rock-solid, non-blocking hardware interaction that guarantees high-performance, concurrent dashboard monitoring without OLT freezing.
 
---

## [DECISION-004] Client IP Rate-Limiting Resolution behind Next.js Proxy

### Status
**APPROVED / IMPLEMENTED**

### Context & Problem
FastAPI's rate limiter (`slowapi`) was blocking the Next.js frontend container IP (`172.19.0.4`) during failed login attempts because `slowapi` default helper resolves the proxy's IP. This caused global 429 locks for all users on the frontend.

### Chosen Solution
Modified the slowapi configuration in `backend/main.py` to use `key_func=get_client_ip` which correctly extracts the client's actual browser IP from the `X-Forwarded-For` header.

---

## [DECISION-005] Self-Healing Automated User Seeding on Lifespan Startup

### Status
**APPROVED / IMPLEMENTED**

### Context & Problem
Fresh containerized database deployments started with an empty `users` table. Standard default seed scripts were not executed automatically, leading to a permanent `401 Unauthorized` block on correct logins.

### Chosen Solution
Integrated a self-healing seed check in the FastAPI `lifespan` function that checks if the `users` table is empty and seeds default credentials (`falcom` / `falcom180` and `guest` / `guest123`) using safe `bcrypt` hashing.

---

## [DECISION-006] Local Backend Docker Build Integration

### Status
**APPROVED / IMPLEMENTED**

### Context & Problem
The `docker-compose.yml` backend service was previously pointing to a pre-built remote registry image (`hugopurohita/olt-web-backend:latest`). This caused local backend code modifications (e.g. rate limit repairs, automated user seeding) to be completely ignored during compose startups.

### Chosen Solution
Replaced `image: hugopurohita/olt-web-backend:latest` with a hybrid configuration specifying both `build: ./backend` and `image: hugopurohita/olt-web-backend:latest` under the `backend` service definition in `docker-compose.yml`. 

This satisfies two environments perfectly:
1. **Local Development (Windows)**: Allows running `docker compose up --build -d` to compile and tag the local code.
2. **Production/Staging (CasaOS)**: Allows the CasaOS web UI parser to successfully resolve the required `image` and `tag` fields instead of leaving them blank and failing stack installation.

---

## [DECISION-007] ZTE C600 & C320 Unified Telemetry Calibration (Optical Power & Temperature)

### Status
**APPROVED / IMPLEMENTED**

### Context & Problem
Different ZTE OLT models (C600 vs C320) had divergent power calculation functions in the codebase. Furthermore, hardware glitches and disconnected/inactive fibers could report out-of-bounds metrics (e.g. extremely low/high raw temperatures or unrealistic optical dBm), leading to confusing spikes in charts and table displays.

### Chosen Solution
1. **Unified Power Formula**: Standardized both C600 and C320 to use:
   $$dBm = (V_{raw} \times 0.002) - 30$$
   with 16-bit signed integer two's complement correction (if $V_{raw} \geq 32768 \rightarrow V_{raw} = V_{raw} - 65536$).
2. **Range Bounds Filtering**:
   - **Rx Power Range**: Filtered to $[-32.0\text{ dBm}, -14.0\text{ dBm}]$. Values outside this range are treated as `None` (JSON `null`), which the frontend resolves gracefully as `"-"`.
   - **Tx Power Range**: Filtered to $[-10.0\text{ dBm}, +12.0\text{ dBm}]$. Out-of-range values return `None`.
   - **Temperature Formula & Range**: Standardized temperature raw input conversion to $V_{raw} / 256.0$. Values outside $[-30.0^\circ\text{C}, +80.0^\circ\text{C}]$ are filtered to `None`.




