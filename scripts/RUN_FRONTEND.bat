@echo off
setlocal
cd /d "%~dp0..\frontend"
if not exist "node_modules\.bin\vite.cmd" (
  echo ERROR: frontend dependencies are missing.
  echo Run START_SENTINEL.bat from the project root first.
  pause
  exit /b 1
)
call npm run dev -- --host 127.0.0.1 --port 5173
pause
