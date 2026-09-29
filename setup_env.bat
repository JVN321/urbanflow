@echo off
REM UrbanFlow Environment Setup Script (Python venv + npm)
REM Usage: setup_env.bat

echo ======================================================
echo       UrbanFlow Environment Initialization (Windows)   
echo ======================================================

where python >nul 2>&1
if errorlevel 1 (
    echo Error: Python is not found in PATH.
    pause
    exit /b 1
)

set VENV_DIR=backend\venv

if not exist "%VENV_DIR%" (
    echo Creating Python virtual environment in %VENV_DIR%...
    python -m venv %VENV_DIR%
) else (
    echo Virtual environment already exists in %VENV_DIR%.
)

echo Installing backend dependencies...
call %VENV_DIR%\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r backend\requirements.txt

where npm >nul 2>&1
if not errorlevel 1 (
    echo Installing frontend dependencies...
    cd frontend
    call npm install
    cd ..
)

echo.
echo ======================================================
echo   Setup Complete!
echo ======================================================
echo.
echo To run backend:
echo     cd backend
echo     venv\Scripts\activate
echo     uvicorn app.main:app --reload --port 8000
echo.
echo To run frontend:
echo     cd frontend
echo     npm run dev
echo.
pause
