@echo off
setlocal
cd /d "%~dp0..\backend"
if not exist ".venv\Scripts\python.exe" (
  echo ERROR: backend virtual environment is missing.
  echo Run START_SENTINEL.bat from the project root first.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" -m uvicorn app.api:app --host 127.0.0.1 --port 8000
pause
