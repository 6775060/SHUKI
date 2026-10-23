@echo off
setlocal
cd /d "%~dp0"
echo.
echo === Shefa u-Behirut: installing ===
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Download the LTS version from https://nodejs.org and run install.bat again.
  pause
  exit /b 1
)
for /f "tokens=1 delims=." %%v in ('node -v') do set NODE_RAW=%%v
set NODE_MAJOR=%NODE_RAW:v=%
if %NODE_MAJOR% LSS 22 (
  echo Node.js 22 or newer is required. Found:
  node -v
  pause
  exit /b 1
)

echo [1/3] Installing server (this also downloads the browser used to read bank sites)...
pushd server
call npm install --no-fund --no-audit
if errorlevel 1 goto :fail
popd

echo [2/3] Installing interface...
pushd web
call npm install --no-fund --no-audit
if errorlevel 1 goto :fail
echo [3/3] Building interface...
call npm run build
if errorlevel 1 goto :fail
popd

echo.
echo Done. Run start.bat to open the app.
pause
exit /b 0

:fail
popd
echo.
echo Installation failed. See the messages above.
pause
exit /b 1
