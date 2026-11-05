; Windows installer for Shefa u-Behirut. Built by packaging/build-windows.mjs:
;   makensis -DVERSION=x.y.z -DSTAGE=<staged app folder> -DOUTFILE=<setup.exe> installer.nsi
; Installs per user (no admin rights), keeps the user's data on uninstall.

Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"

!define APPNAME "שפע ובהירות"
!define APPID "ShefaUBehirut"

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\${APPID}"
InstallDirRegKey HKCU "Software\${APPID}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "${APPNAME} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Shefa u-Behirut"
VIAddVersionKey "FileDescription" "Shefa u-Behirut installer"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" " "

!define MUI_ICON "${STAGE}\shefa.ico"
!define MUI_UNICON "${STAGE}\shefa.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "ברוך הבא להתקנת ${APPNAME}"
!define MUI_WELCOMEPAGE_TEXT "מערכת לניהול כספי הבית והעסק – בהירות, שקט ותוכנית.$\r$\n$\r$\nהכול נשמר רק במחשב הזה. לא צריך התקנות נוספות ולא הרשאות מנהל.$\r$\n$\r$\nלחץ 'הבא' כדי להמשיך."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION OpenApp
!define MUI_FINISHPAGE_RUN_TEXT "לפתוח את ${APPNAME} עכשיו"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Hebrew"

Function OpenApp
  Exec '"$WINDIR\System32\wscript.exe" "$INSTDIR\launch.vbs"'
FunctionEnd

Function StopRunning
  IfFileExists "$INSTDIR\launcher.mjs" 0 done
    ExecWait '"$INSTDIR\node\node.exe" "$INSTDIR\launcher.mjs" --stop'
    Sleep 1500
  done:
FunctionEnd

Section "${APPNAME}" SecApp
  SectionIn RO
  Call StopRunning
  SetOutPath "$INSTDIR"
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\web"
  File /r "${STAGE}\*"

  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$WINDIR\System32\wscript.exe" '"$INSTDIR\launch.vbs"' "$INSTDIR\shefa.ico"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\עצירת ${APPNAME}.lnk" "$WINDIR\System32\wscript.exe" '"$INSTDIR\launch.vbs" --stop' "$INSTDIR\shefa.ico"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\הסרת ${APPNAME}.lnk" "$INSTDIR\uninstall.exe"

  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "Software\${APPID}" "InstallDir" "$INSTDIR"
  !define UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPID}"
  WriteRegStr HKCU "${UNINST}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINST}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST}" "DisplayIcon" "$INSTDIR\shefa.ico"
  WriteRegStr HKCU "${UNINST}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "${UNINST}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "${UNINST}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINST}" "EstimatedSize" "$0"
SectionEnd

Section "סמל בשולחן העבודה" SecDesktop
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$WINDIR\System32\wscript.exe" '"$INSTDIR\launch.vbs"' "$INSTDIR\shefa.ico"
SectionEnd

Section "הפעלה אוטומטית עם Windows (לסנכרון היומי)" SecStartup
  CreateShortcut "$SMSTARTUP\${APPNAME}.lnk" "$WINDIR\System32\wscript.exe" '"$INSTDIR\launch.vbs" --background' "$INSTDIR\shefa.ico"
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecApp} "המערכת עצמה."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "סמל לפתיחה מהירה בשולחן העבודה."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecStartup} "המערכת עולה ברקע כשהמחשב נדלק, כדי שהסנכרון היומי עם הבנקים ירוץ."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  IfFileExists "$INSTDIR\launcher.mjs" 0 +3
    ExecWait '"$INSTDIR\node\node.exe" "$INSTDIR\launcher.mjs" --stop'
    Sleep 1500
  Delete "$DESKTOP\${APPNAME}.lnk"
  Delete "$SMSTARTUP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPID}"
  DeleteRegKey HKCU "Software\${APPID}"
  MessageBox MB_OK "המערכת הוסרה. הנתונים שלך (תנועות, חיבורים וסיסמאות מוצפנות) נשארו בתיקייה:$\r$\n$APPDATA\${APPID}$\r$\nאפשר למחוק אותה ידנית אם רוצים."
SectionEnd
