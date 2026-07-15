Var ReferenceFlowDataDir

!macro customInit
  StrCpy $ReferenceFlowDataDir "$DOCUMENTS\ReferenceFlow"
!macroend

PageEx directory
  DirVar $ReferenceFlowDataDir
  DirText "Choose where ReferenceFlow should save board images, notes, sketches, and board JSON."
  PageCallbacks "" "" ReferenceFlowDataDirLeave
PageExEnd

Function ReferenceFlowDataDirLeave
  CreateDirectory "$ReferenceFlowDataDir"
FunctionEnd

!macro customInstall
  CreateDirectory "$ReferenceFlowDataDir"
  FileOpen $0 "$INSTDIR\referenceflow-data-dir.txt" w
  FileWrite $0 "$ReferenceFlowDataDir"
  FileClose $0
  WriteRegStr HKCU "Software\ReferenceFlow" "DataDirectory" "$ReferenceFlowDataDir"
!macroend

!macro customUnInstall
  Delete "$INSTDIR\referenceflow-data-dir.txt"
  DeleteRegKey HKCU "Software\ReferenceFlow"
!macroend
