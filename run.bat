@echo off
rem ==============================================================================
rem UrbanFlow - Unified Launcher Script for Windows (Backend & Frontend)
rem Automatically sources environment, installs packages, and launches servers.
rem ==============================================================================

setlocal enabledelayedexpansion

set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"
set "BACKEND_DIR=%ROOT_DIR%\backend"
set "FRONTEND_DIR=%ROOT_DIR%\frontend"

echo ======================================================================
echo   UrbanFlow Simulation ^& Optimization Suite (Windows Launcher)
echo ======================================================================

rem ------------------------------------------------------------------------------
rem 1. Configure and Load Environment Files (.env)
rem ------------------------------------------------------------------------------
if not exist "%BACKEND_DIR%\.env" (
    if exist "%BACKEND_DIR%\.env.example" (
        echo [INFO] Creating backend\.env from template...
        copy "%BACKEND_DIR%\.env.example" "%BACKEND_DIR%\.env" >nul
    )
)

if not exist "%FRONTEND_DIR%\.env" (
    if exist "%FRONTEND_DIR%\.env.example" (
        echo [INFO] Creating frontend\.env from template...
        copy "%FRONTEND_DIR%\.env.example" "%FRONTEND_DIR%\.env" >nul
    )
)

set "BACKEND_HOST=127.0.0.1"
set "BACKEND_PORT=8000"

rem Read HOST and PORT from backend\.env if present
if exist "%BACKEND_DIR%\.env" (
    for /f "usebackq tokens=1,2 delims==" %%A in ("%BACKEND_DIR%\.env") do (
        if "%%A"=="HOST" set "BACKEND_HOST=%%B"
        if "%%A"=="PORT" set "BACKEND_PORT=%%B"
    )
)

echo   Root Directory:    %ROOT_DIR%
echo   Backend Target:    http://%BACKEND_HOST%:%BACKEND_PORT%
echo   Frontend Target:   http://localhost:3000
echo ======================================================================

rem ------------------------------------------------------------------------------
rem 2. Detect Python and Virtual Environment
rem ------------------------------------------------------------------------------
set "PYTHON_EXE="
where python >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_EXE=python"
) else (
    where py >nul 2>&1
    if not errorlevel 1 (
        set "PYTHON_EXE=py -3"
    ) else (
        echo [ERROR] Python 3 was not found in PATH. Please install Python 3.10+ and add it to PATH.
        pause
        exit /b 1
    )
)

set "VENV_PATH="
if exist "%BACKEND_DIR%\venv\Scripts\activate.bat" (
    set "VENV_PATH=%BACKEND_DIR%\venv"
) else if exist "%ROOT_DIR%\venv\Scripts\activate.bat" (
    set "VENV_PATH=%ROOT_DIR%\venv"
) else if exist "%ROOT_DIR%\.venv\Scripts\activate.bat" (
    set "VENV_PATH=%ROOT_DIR%\.venv"
) else if exist "%BACKEND_DIR%\.venv\Scripts\activate.bat" (
    set "VENV_PATH=%BACKEND_DIR%\.venv"
)

if defined VENV_PATH (
    echo [INFO] Activating existing Python virtual environment: %VENV_PATH%
    call "%VENV_PATH%\Scripts\activate.bat"
    if not exist "%VENV_PATH%\Scripts\uvicorn.exe" (
        echo [INFO] Missing backend packages. Installing requirements...
        python -m pip install --upgrade pip
        pip install -r "%BACKEND_DIR%\requirements.txt"
    )
) else (
    echo [INFO] Creating new Python virtual environment in %BACKEND_DIR%\venv...
    %PYTHON_EXE% -m venv "%BACKEND_DIR%\venv"
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
    set "VENV_PATH=%BACKEND_DIR%\venv"
    call "%VENV_PATH%\Scripts\activate.bat"
    echo [INFO] Installing backend dependencies from requirements.txt...
    python -m pip install --upgrade pip
    pip install -r "%BACKEND_DIR%\requirements.txt"
)

rem ------------------------------------------------------------------------------
rem 3. Detect Node Package Manager (pnpm preferred, npm fallback)
rem ------------------------------------------------------------------------------
set "PKG_MGR="
where pnpm >nul 2>&1
if not errorlevel 1 (
    set "PKG_MGR=pnpm"
) else (
    where npm >nul 2>&1
    if not errorlevel 1 (
        set "PKG_MGR=npm"
    ) else (
        echo [ERROR] Neither pnpm nor npm was found in PATH. Please install Node.js (v18+).
        pause
        exit /b 1
    )
)

if not exist "%FRONTEND_DIR%\node_modules" (
    echo [INFO] Installing frontend dependencies using %PKG_MGR%...
    cd /d "%FRONTEND_DIR%"
    call %PKG_MGR% install
    if errorlevel 1 (
        echo [ERROR] Failed to install frontend dependencies.
        cd /d "%ROOT_DIR%"
        pause
        exit /b 1
    )
    cd /d "%ROOT_DIR%"
)

rem ------------------------------------------------------------------------------
rem 4. Start Backend FastAPI Server in Dedicated Background Window
rem ------------------------------------------------------------------------------
echo [INFO] Starting Backend FastAPI Server on http://%BACKEND_HOST%:%BACKEND_PORT%...
start "UrbanFlow_Backend" cmd /k "title UrbanFlow_Backend && cd /d "%BACKEND_DIR%" && call "%VENV_PATH%\Scripts\activate.bat" && set PYTHONPATH=%BACKEND_DIR% && uvicorn app.main:app --host %BACKEND_HOST% --port %BACKEND_PORT% --reload"

rem Wait for backend health endpoint to respond
echo [INFO] Waiting for backend server to become healthy...
set "BACKEND_READY=0"
for /l %%I in (1,1,30) do (
    if "!BACKEND_READY!"=="0" (
        where curl >nul 2>&1
        if not errorlevel 1 (
            curl --silent --fail "http://127.0.0.1:%BACKEND_PORT%/api/health" >nul 2>&1
            if not errorlevel 1 set "BACKEND_READY=1"
        ) else (
            timeout /t 2 /nobreak >nul 2>&1
            set "BACKEND_READY=1"
        )
        if "!BACKEND_READY!"=="0" (
            timeout /t 1 /nobreak >nul 2>&1
        )
    )
)

rem ------------------------------------------------------------------------------
rem 5. Display Status Banner and Start Frontend Dev Server
rem ------------------------------------------------------------------------------
echo.
echo ======================================================================
echo   UrbanFlow is RUNNING!
echo   Frontend: http://localhost:3000
echo   API Docs: http://localhost:%BACKEND_PORT%/docs
echo   Press Ctrl+C to terminate frontend and backend.
echo ======================================================================
echo.

cd /d "%FRONTEND_DIR%"
call %PKG_MGR% run dev

rem ------------------------------------------------------------------------------
rem 6. Cleanup on Exit
rem ------------------------------------------------------------------------------
echo.
echo [INFO] Shutting down UrbanFlow backend server...
taskkill /FI "WINDOWTITLE eq UrbanFlow_Backend*" /F /T >nul 2>&1
for /f "tokens=5" %%P in ('netstat -aon ^| findstr ":%BACKEND_PORT% " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%P >nul 2>&1
)
echo [OK] All UrbanFlow services stopped.
cd /d "%ROOT_DIR%"
exit /b 0
