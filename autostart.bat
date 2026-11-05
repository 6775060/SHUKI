@echo off
setlocal
rem Adds a shortcut to the Windows Startup folder so the app starts (minimized) with Windows.
set "TARGET=%~dp0start.bat"
set "LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Shefa u-Behirut.lnk"
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%LINK%'); $s.TargetPath='%TARGET%'; $s.Arguments='nobrowser'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()"
if errorlevel 1 (
  echo Could not create the startup shortcut.
) else (
  echo The app will now start automatically with Windows.
  echo To undo, delete: %LINK%
)
pause
