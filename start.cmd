@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   GitDeck needs Node.js 22 or newer.
  echo   Download it from https://nodejs.org/
  echo.
  pause
  exit /b 1
)

where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo   GitDeck needs Git installed and available in PATH.
  echo   Download it from https://git-scm.com/
  echo.
  pause
  exit /b 1
)

if not exist node_modules\vite\bin\vite.js (
  echo.
  echo   Installing GitDeck dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   Dependency installation failed.
    pause
    exit /b 1
  )
)

echo.
echo   Building GitDeck...
call npm run build
if errorlevel 1 (
  echo.
  echo   Build failed.
  pause
  exit /b 1
)

echo.
echo   Starting GitDeck at http://127.0.0.1:4788
echo   Press Ctrl+C to stop.
echo.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:4788'"
node server/index.js
