Set oWS = CreateObject("WScript.Shell")
sLinkFile = "D:\OneDrive\Máy tính\OmniFlow Studio.lnk"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = "d:\tool auto\FM-AUTO-OPS\OmniFlow Studio.exe"
oLink.WorkingDirectory = "d:\tool auto\FM-AUTO-OPS"
oLink.IconLocation = "d:\tool auto\FM-AUTO-OPS\assets\omniflow-logo-new.ico,0"
oLink.Description = "OmniFlow Studio Enterprise RPA Platform"
oLink.Save
