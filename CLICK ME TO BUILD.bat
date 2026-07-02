@echo off
title Enigma Builder
color 0D
cls
echo.
echo  =====================================================
echo   ENIGMA - .EXE BUILDER
echo  =====================================================
echo.

REM --- Check we are in the right folder ---
if not exist "package.json" (
    echo  ERROR: Cannot find package.json
    echo  Make sure you are running this .bat from INSIDE
    echo  the browser\ folder, not from outside it.
    echo.
    pause
    exit /b 1
)

REM --- Check Node.js ---
echo  [1/3] Checking Node.js...
node --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  Node.js is NOT installed.
    echo  Opening nodejs.org for you to download it.
    echo.
    echo  STEPS:
    echo    1. Download the Windows installer from nodejs.org
    echo    2. Install it (keep all defaults, click Next)
    echo    3. CLOSE and re-open this .bat file
    echo.
    start https://nodejs.org/en/download
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do set NODEVER=%%v
echo  OK - Node.js %NODEVER% found
echo.

REM --- npm install ---
echo  [2/3] Installing dependencies...
echo  (First run downloads ~150MB of Electron - please wait)
echo  You will see lots of text below - that is normal.
echo  -------------------------------------------------------
echo.
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  =====================================================
    echo  ERROR: npm install failed (see messages above)
    echo  Most common fixes:
    echo    - Check your internet connection
    echo    - Disable antivirus temporarily
    echo    - Run as Administrator
    echo  =====================================================
    echo.
    pause
    exit /b 1
)
echo.
echo  OK - Dependencies installed
echo.

REM --- Build ---
echo  [3/3] Building Enigma .exe...
echo  (Takes 2-5 minutes - do not close this window)
echo  -------------------------------------------------------
echo.
call npm run build:win
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  =====================================================
    echo  ERROR: Build failed (see messages above)
    echo  Most common fixes:
    echo    - Run as Administrator (right-click -> Run as Admin)
    echo    - Disable antivirus / Windows Defender temporarily
    echo    - Make sure you have at least 1GB free disk space
    echo  =====================================================
    echo.
    pause
    exit /b 1
)

REM --- Done ---
echo.
echo  =====================================================
echo   SUCCESS! Your .exe files are in the dist\ folder:
echo  =====================================================
echo.
dir dist\*.exe /b 2>nul
echo.
echo  Run: Enigma-Setup-1.0.0.exe to install
echo  It will create a Desktop shortcut automatically.
echo.
echo  Opening dist\ folder now...
explorer dist
echo.
pause
