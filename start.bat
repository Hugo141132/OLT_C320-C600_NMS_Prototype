@echo off
echo [OLT-WEB] Stopping existing processes...

REM Kill process on port 3000 (Next.js frontend)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)

REM Kill process on port 8765 (FastAPI backend)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8765 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)

echo [OLT-WEB] Starting services...
wt -d . cmd /k "pnpm dev" ; new-tab -d .\backend cmd /k "python main.py"
