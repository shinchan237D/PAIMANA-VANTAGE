@echo off
setlocal
cd /d "%~dp0"
echo.
echo Stopping PAIMANA Sentinel processes...
powershell -NoProfile -Command "$procs=Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'uvicorn app\.api:app.*--port 8000' -or $_.CommandLine -match 'vite.*--port 5173' -or $_.CommandLine -match 'npm run dev.*5173' }; $procs | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; Write-Host ('Stopped PID ' + $_.ProcessId) } catch {} }"
echo Done.
pause
