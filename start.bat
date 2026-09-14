@echo off
echo Starting Control Tower Backend and Frontend...

start "Control Tower - Backend" cmd /k "cd /d %~dp0bend && .\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000"
start "Control Tower - Frontend" cmd /k "cd /d %~dp0fend && npm run dev"

echo Waiting 3 seconds then opening browser...
timeout /t 3 >nul
start http://localhost:5173
