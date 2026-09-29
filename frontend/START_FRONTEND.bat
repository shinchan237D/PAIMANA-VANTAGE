@echo off
pushd "%~dp0"
if not exist node_modules call npm install
npm run dev
popd
