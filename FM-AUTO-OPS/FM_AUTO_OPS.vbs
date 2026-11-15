Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Target directories
appDir = "d:\tool auto\FM-AUTO-OPS\apps\local-agent"
WshShell.CurrentDirectory = appDir

electronExe = appDir & "\node_modules\electron\dist\electron.exe"
mainJs = appDir & "\dist\main\index.js"

If Not fso.FileExists(electronExe) Then
  MsgBox "Không tìm thấy file electron.exe tại: " & electronExe, 16, "FM AUTO OPS Error"
  WScript.Quit 1
End If

' 1. Check if an active window is already visible
activated = WshShell.AppActivate("OmniFlow Studio")
If Not activated Then
  activated = WshShell.AppActivate("FM AUTO OPS")
End If

If activated Then
  ' Window successfully brought to foreground!
  WScript.Quit 0
End If

' 2. Check if zombie electron process exists
Set objWMIService = GetObject("winmgmts:\\.\root\cimv2")
Set colProcesses = objWMIService.ExecQuery("Select * from Win32_Process Where Name = 'electron.exe'")

If colProcesses.Count > 0 Then
  ' An electron process is running but had no activatable window -> Kill zombie
  WshShell.Run "taskkill /F /IM electron.exe /T", 0, True
  WScript.Sleep 400
End If

' 3. Launch fresh instance completely silent without black console window
launchCmd = """" & electronExe & """ """ & mainJs & """"
WshShell.Run launchCmd, 0, False
