@echo off
echo ========================================================
echo Starting Control Tower Backend and Frontend Servers...
echo ========================================================

:: Start FastAPI Backend
start "Control Tower - Backend" cmd /k "cd /d %~dp0bend && echo Starting FastAPI backend... && .\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000"

:: Start React Frontend
start "Control Tower - Frontend" cmd /k "cd /d %~dp0fend && echo Starting React frontend... && npm run dev"

echo Waiting 5 seconds for servers to initialize...
timeout /t 5 >nul

echo Opening application in default web browser...
start http://127.0.0.1:5173

echo Control Tower is now running.
