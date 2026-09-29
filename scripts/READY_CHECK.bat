@echo off
setlocal
cd /d "%~dp0.."
where py >nul 2>nul
if errorlevel 1 echo [FAIL] Python launcher not found.&goto fail
where node >nul 2>nul
if errorlevel 1 echo [FAIL] Node.js not found.&goto fail
where npm >nul 2>nul
if errorlevel 1 echo [FAIL] npm not found.&goto fail
if not exist "backend\data\paimana_sentinel.db" echo [FAIL] Bundled database missing.&goto fail
if not exist "frontend\package.json" echo [FAIL] Frontend package manifest missing.&goto fail
echo [OK] Machine prerequisites and bundled data are present.
powershell -NoProfile -Command "try {$r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:8000/api/v3/health; if($r.StatusCode -eq 200){exit 0}} catch {}; exit 1" >nul 2>nul
if errorlevel 1 (
  echo [INFO] Sentinel backend is not running yet. Launch START_SENTINEL.bat to start the system.
) else (
  echo [OK] Sentinel backend is already healthy.
  call "backend\.venv\Scripts\python.exe" "scripts\SMOKE_TEST.py" http://127.0.0.1:8000/api/v3
)
pause
exit /b 0
:fail
pause
exit /b 1
