@echo off
setlocal
cd /d "%~dp0server"
if not exist node_modules (
  echo Run install.bat first.
  pause
  exit /b 1
)
title Shefa u-Behirut (keep this window open)
if /i not "%~1"=="nobrowser" start "" /b cmd /c "timeout /t 4 >nul & start http://127.0.0.1:4870"
call npm start
