# Creates a desktop shortcut for the per-user NSIS installation.

$appPath = Join-Path $env:LOCALAPPDATA "Programs\OmniFlow Studio\OmniFlow Studio.exe"
if (-not (Test-Path -LiteralPath $appPath)) {
  throw "OmniFlow Studio is not installed for this Windows user: $appPath"
}

$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "OmniFlow Studio.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $appPath
$shortcut.WorkingDirectory = Split-Path -Parent $appPath
$shortcut.Description = "OmniFlow Studio"
$iconPath = Join-Path (Split-Path -Parent $appPath) "resources\app\assets\app-icon.ico"
if (Test-Path -LiteralPath $iconPath) { $shortcut.IconLocation = "$iconPath,0" }
$shortcut.Save()

Write-Host "Created shortcut: $shortcutPath"
