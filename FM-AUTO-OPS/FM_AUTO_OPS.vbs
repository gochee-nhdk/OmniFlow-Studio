Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

workingDir = "d:\tool auto\FM-AUTO-OPS\apps\local-agent"
WshShell.CurrentDirectory = workingDir

electronExe = workingDir & "\node_modules\electron\dist\electron.exe"
electronCmd = workingDir & "\node_modules\.bin\electron.cmd"

If fso.FileExists(electronExe) Then
  cmd = """" & electronExe & """ dist\main\index.js"
ElseIf fso.FileExists(electronCmd) Then
  cmd = "cmd /c """ & electronCmd & """ dist\main\index.js"
Else
  cmd = "cmd /c npx electron dist\main\index.js"
End If

WshShell.Run cmd, 0, False
