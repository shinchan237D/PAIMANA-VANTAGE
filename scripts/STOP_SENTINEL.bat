@echo off
taskkill /FI "WINDOWTITLE eq PAIMANA Sentinel Backend*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq PAIMANA Sentinel Frontend*" /T /F >nul 2>&1
echo Sentinel processes stopped.
