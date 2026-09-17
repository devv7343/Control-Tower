@echo off
echo ========================================================
echo First-time Setup for Control Tower
echo ========================================================
echo.

echo Checking for Node.js (npm)...
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] npm is not installed or not in your PATH. 
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b
)

echo Checking for Python...
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] python is not installed or not in your PATH.
    echo Please install Python 3.8+ from https://www.python.org/
    echo Make sure to check "Add Python to PATH" during installation.
    pause
    exit /b
)

echo.
echo Installing Frontend Dependencies...
cd /d %~dp0fend
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install frontend dependencies.
    pause
    exit /b
)

echo.
echo Setting up Python Backend Environment...
cd /d %~dp0bend
if not exist .venv (
    echo Creating virtual environment...
    python -m venv .venv
)

echo Installing Python dependencies...
call .venv\Scripts\pip.exe install -r requirements.txt
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install Python dependencies.
    pause
    exit /b
)

echo.
echo ========================================================
echo Setup Complete! 
echo You can now use start.bat to run the application.
echo ========================================================
pause
