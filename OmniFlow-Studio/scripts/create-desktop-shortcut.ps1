# Creates a desktop shortcut for OmniFlow Studio (supports portable and installed modes).

$targetExe = $null

# Check candidate paths: portable mode first (current workspace or parent), then installed mode
$candidatePaths = @(
  (Join-Path $PSScriptRoot "..\OmniFlow Studio.exe"),
  (Join-Path $PSScriptRoot "OmniFlow Studio.exe"),
  (Join-Path (Get-Location) "OmniFlow Studio.exe"),
  (Join-Path (Get-Location) "OmniFlow-Studio\OmniFlow Studio.exe"),
  (Join-Path $env:LOCALAPPDATA "Programs\OmniFlow Studio\OmniFlow Studio.exe")
)

foreach ($path in $candidatePaths) {
  if (Test-Path -LiteralPath $path) {
    $targetExe = (Resolve-Path -LiteralPath $path).Path
    break
  }
}

if (-not $targetExe) {
  throw "OmniFlow Studio.exe not found in portable directory or user installation."
}

$targetDir = Split-Path -Parent $targetExe
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "OmniFlow Studio.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetExe
$shortcut.WorkingDirectory = $targetDir
$shortcut.Description = "OmniFlow Studio"

# Determine icon path if available
$iconCandidates = @(
  (Join-Path $targetDir "assets\app-icon.ico"),
  (Join-Path $targetDir "OmniFlow-Studio\assets\app-icon.ico"),
  (Join-Path $targetDir "resources\app\assets\app-icon.ico"),
  $targetExe
)

foreach ($icon in $iconCandidates) {
  if (Test-Path -LiteralPath $icon) {
    $shortcut.IconLocation = "$icon,0"
    break
  }
}

$shortcut.Save()

Write-Host "Created shortcut: $shortcutPath -> $targetExe"
