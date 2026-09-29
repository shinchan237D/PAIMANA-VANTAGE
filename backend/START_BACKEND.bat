@echo off
pushd "%~dp0"
py -m pip install -r requirements.txt
py -m uvicorn app.api:app --host 127.0.0.1 --port 8000
popd
