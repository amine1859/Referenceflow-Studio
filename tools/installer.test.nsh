Var ReferenceFlowTestDataDir

!macro customInit
  StrCpy $ReferenceFlowTestDataDir "$DOCUMENTS\ReferenceFlow Test"
!macroend

PageEx directory
  DirVar $ReferenceFlowTestDataDir
  DirText "Choose where the isolated RefFlowStudio Test app should save its test boards."
  PageCallbacks "" "" ReferenceFlowTestDataDirLeave
PageExEnd

Function ReferenceFlowTestDataDirLeave
  CreateDirectory "$ReferenceFlowTestDataDir"
FunctionEnd

!macro customInstall
  CreateDirectory "$ReferenceFlowTestDataDir"
  FileOpen $0 "$INSTDIR\referenceflow-data-dir.txt" w
  FileWrite $0 "$ReferenceFlowTestDataDir"
  FileClose $0
  WriteRegStr HKCU "Software\ReferenceFlowTest" "DataDirectory" "$ReferenceFlowTestDataDir"
!macroend

!macro customUnInstall
  Delete "$INSTDIR\referenceflow-data-dir.txt"
  DeleteRegKey HKCU "Software\ReferenceFlowTest"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}"
!macroend
