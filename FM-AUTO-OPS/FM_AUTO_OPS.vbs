Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

workingDir = "d:\tool auto\FM-AUTO-OPS\apps\local-agent"
WshShell.CurrentDirectory = workingDir

electronPath = workingDir & "\node_modules\.bin\electron.cmd"

If fso.FileExists(electronPath) Then
  cmd = "cmd /c """ & electronPath & """ dist\main\index.js"
Else
  cmd = "cmd /c npx electron dist\main\index.js"
End If

WshShell.Run cmd, 0, False
