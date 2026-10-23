@echo off
setlocal
cd /d "%~dp0"
echo.
echo === Shefa u-Behirut: installing ===
echo.
if not exist "%~dp0server\package.json" (
  echo The project files were not found next to install.bat.
  echo It looks like install.bat was opened from inside the ZIP file.
  echo Extract the ZIP first ^(right-click, "Extract All"^),
  echo then run install.bat from the extracted folder.
  pause
  exit /b 1
)
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
pushd "%~dp0server" || goto :fail
call npm install --no-fund --no-audit
rem npm.cmd does not always pass its exit code back, so check the result itself.
if not exist node_modules\tsx goto :fail
if not exist node_modules\israeli-bank-scrapers goto :fail
popd

echo [2/3] Installing interface...
pushd "%~dp0web" || goto :fail
call npm install --no-fund --no-audit
if not exist node_modules\vite goto :fail
echo [3/3] Building interface...
if exist dist rmdir /s /q dist
call npm run build
if not exist dist\index.html goto :fail
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
