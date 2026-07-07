; Smart Fill System -- NSIS Installer
; Build: makensis installer.nsi

!define PRODUCT_NAME "Smart Fill System"
!define PRODUCT_VERSION "1.3.0"
!define PRODUCT_PUBLISHER "SmartFill"

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "SmartFill-Setup-${PRODUCT_VERSION}.exe"
InstallDir "$PROGRAMFILES64\${PRODUCT_NAME}"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

!include "MUI2.nsh"
!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "Install"
  SetOutPath "$INSTDIR"

  ; Copy entire project (recursive directories + root files)
  File /r /x ".git" /x ".opencode" /x "installer.nsi" /x "SmartFill-Setup-*.exe" ".\*"

  ; Create .env from template (triggers first-run setup page)
  CopyFiles /SILENT "$INSTDIR\config\.env.example" "$INSTDIR\config\.env"

  ; Desktop shortcut
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" \
    "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" \
    '-ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\start.ps1"' \
    "$INSTDIR\browser\chromium-1228\chrome-win64\chrome.exe" 0

  WriteUninstaller "$INSTDIR\uninstall.exe"

  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "NoRepair" 1
SectionEnd

Section "Uninstall"
  RMDir /r "$INSTDIR"
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
SectionEnd
