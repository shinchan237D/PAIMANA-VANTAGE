@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "ROOT=%~dp0"

title PAIMANA Sentinel - Startup

echo.
echo ============================================================
echo   PAIMANA SENTINEL - HACKATHON STARTUP
echo ============================================================
echo.

echo [1/5] Checking Python launcher...
where py >nul 2>nul
if errorlevel 1 (
  echo [FAIL] Python launcher ^(py^) was not found.
  echo        Install Python 3.11+ and make sure the Python launcher is enabled.
  pause
  exit /b 1
)

set "PY_CMD=py"
py -3.13 -V >nul 2>&1 && set "PY_CMD=py -3.13"
if "%PY_CMD%"=="py" py -3.12 -V >nul 2>&1 && set "PY_CMD=py -3.12"
if "%PY_CMD%"=="py" py -3.11 -V >nul 2>&1 && set "PY_CMD=py -3.11"
echo       Using %PY_CMD%

echo [2/5] Checking Node.js and npm...
where node >nul 2>nul
if errorlevel 1 (
  echo [FAIL] Node.js was not found.
  echo        Install Node.js 18+ ^(LTS recommended^).
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [FAIL] npm was not found.
  echo        Reinstall Node.js with npm enabled.
  pause
  exit /b 1
)

if not exist "%ROOT%backend\data\paimana_sentinel.db" (
  echo [FAIL] Bundled database is missing: backend\data\paimana_sentinel.db
  pause
  exit /b 1
)
if not exist "%ROOT%frontend\package.json" (
  echo [FAIL] Frontend package manifest is missing.
  pause
  exit /b 1
)

echo [3/5] Preparing Python runtime...
if not exist "%ROOT%backend\.venv\Scripts\python.exe" (
  echo       Creating isolated backend virtual environment...
  %PY_CMD% -m venv "%ROOT%backend\.venv"
  if errorlevel 1 (
    echo [FAIL] Could not create backend virtual environment.
    pause
    exit /b 1
  )
)

"%ROOT%backend\.venv\Scripts\python.exe" -c "import fastapi,uvicorn" >nul 2>nul
if errorlevel 1 (
  echo       Installing backend dependencies...
  "%ROOT%backend\.venv\Scripts\python.exe" -m pip install --disable-pip-version-check --no-input -r "%ROOT%backend\requirements.txt"
  if errorlevel 1 (
    echo [FAIL] Backend dependency installation failed.
    echo        Check internet access and the Backend window for details.
    pause
    exit /b 1
  )
)

echo [4/5] Preparing frontend runtime...
if not exist "%ROOT%frontend\node_modules\.bin\vite.cmd" (
  echo       Installing frontend dependencies ^(first run only^)...
  pushd "%ROOT%frontend"
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    popd
    echo [FAIL] Frontend dependency installation failed.
    echo        Check internet access and try START_SENTINEL.bat again.
    pause
    exit /b 1
  )
  popd
)

echo [5/5] Starting Sentinel services...

powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:8000/api/v3/health; if($r.StatusCode -eq 200){exit 0} } catch {}; exit 1" >nul 2>nul
if errorlevel 1 (
  powershell -NoProfile -Command "$c=Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue; if($c){exit 0}; exit 1" >nul 2>nul
  if not errorlevel 1 (
    echo [FAIL] Port 8000 is already occupied by another service.
    echo        Stop that service or use scripts\STOP_SENTINEL.bat if it is Sentinel.
    pause
    exit /b 1
  )
  start "PAIMANA Sentinel Backend" /D "%ROOT%backend" cmd /k call "%ROOT%scripts\RUN_BACKEND.bat"
)

set "BACKEND_READY=0"
for /L %%i in (1,1,30) do (
  powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://127.0.0.1:8000/api/v3/health; if($r.StatusCode -eq 200){exit 0} } catch {}; exit 1" >nul 2>nul
  if not errorlevel 1 (set "BACKEND_READY=1" & goto backend_ready)
  timeout /t 1 /nobreak >nul
)
:backend_ready
if "%BACKEND_READY%"=="0" (
  echo [FAIL] Backend did not become healthy within 30 seconds.
  echo        Read the PAIMANA Sentinel Backend window for the exact error.
  pause
  exit /b 1
)
echo       Backend: ONLINE

powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:5173/; if($r.StatusCode -ge 200 -and $r.StatusCode -lt 500){exit 0} } catch {}; exit 1" >nul 2>nul
if errorlevel 1 (
  powershell -NoProfile -Command "$c=Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue; if($c){exit 0}; exit 1" >nul 2>nul
  if not errorlevel 1 (
    echo [FAIL] Port 5173 is already occupied by another service.
    echo        Stop that service or use scripts\STOP_SENTINEL.bat if it is Sentinel.
    pause
    exit /b 1
  )
  start "PAIMANA Sentinel Frontend" /D "%ROOT%frontend" cmd /k call "%ROOT%scripts\RUN_FRONTEND.bat"
)

set "FRONTEND_READY=0"
for /L %%i in (1,1,30) do (
  powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://127.0.0.1:5173/; if($r.StatusCode -ge 200 -and $r.StatusCode -lt 500){exit 0} } catch {}; exit 1" >nul 2>nul
  if not errorlevel 1 (set "FRONTEND_READY=1" & goto frontend_ready)
  timeout /t 1 /nobreak >nul
)
:frontend_ready
if "%FRONTEND_READY%"=="0" (
  echo [FAIL] Frontend did not become available within 30 seconds.
  echo        Read the PAIMANA Sentinel Frontend window for the exact error.
  pause
  exit /b 1
)
echo       Frontend: ONLINE

echo.
echo Running final API smoke check...
"%ROOT%backend\.venv\Scripts\python.exe" "%ROOT%scripts\SMOKE_TEST.py" http://127.0.0.1:8000/api/v3
if errorlevel 1 (
  echo [WARN] One or more API smoke checks failed. The UI may still open, but inspect the Backend window before judging.
) else (
  echo       API smoke check: PASS
)

echo.
echo ============================================================
echo   SENTINEL IS READY
echo   Dashboard: http://127.0.0.1:5173
echo ============================================================
echo.
start "" http://127.0.0.1:5173
exit /b 0
