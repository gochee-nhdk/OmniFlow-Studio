$wsh = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$linkPath = [System.IO.Path]::Combine($desktop, "OmniFlow Studio.lnk")
$shortcut = $wsh.CreateShortcut($linkPath)
$shortcut.TargetPath = "d:\tool auto\FM-AUTO-OPS\OmniFlow Studio.exe"
$shortcut.WorkingDirectory = "d:\tool auto\FM-AUTO-OPS"
$shortcut.IconLocation = "d:\tool auto\FM-AUTO-OPS\assets\omniflow-logo-new.ico,0"
$shortcut.Description = "OmniFlow Studio Enterprise RPA Platform"
$shortcut.Save()
Write-Host "SHORTCUT_SAVED_SUCCESSFULLY: $linkPath"
