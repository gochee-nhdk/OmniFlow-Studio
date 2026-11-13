# Creates 1-Click Desktop Shortcuts for FM AUTO OPS

$desktopPaths = @(
  [Environment]::GetFolderPath("Desktop"),
  "D:\OneDrive\Máy tính",
  "C:\Users\$env:USERNAME\Desktop"
) | Select-Object -Unique

$wshShell = New-Object -ComObject WScript.Shell

foreach ($d in $desktopPaths) {
  if (Test-Path $d) {
    # 1. Desktop App Shortcut
    $scApp = $wshShell.CreateShortcut((Join-Path $d "FM AUTO OPS (Desktop App).lnk"))
    $scApp.TargetPath = "wscript.exe"
    $scApp.Arguments = "`"d:\tool auto\FM-AUTO-OPS\FM_AUTO_OPS.vbs`""
    $scApp.WorkingDirectory = "d:\tool auto\FM-AUTO-OPS"
    $scApp.Description = "FM AUTO OPS — Desktop Native Application"
    $scApp.WindowStyle = 7
    $scApp.Save()

    # 2. Web Dashboard Shortcut (Instant Server + Browser)
    $scWeb = $wshShell.CreateShortcut((Join-Path $d "FM AUTO OPS (Web Dashboard).lnk"))
    $scWeb.TargetPath = "wscript.exe"
    $scWeb.Arguments = "`"d:\tool auto\FM-AUTO-OPS\Open_Web_Dashboard.vbs`""
    $scWeb.WorkingDirectory = "d:\tool auto\FM-AUTO-OPS"
    $scWeb.Description = "FM AUTO OPS — Browser Dashboard (Instant 1-Click)"
    $scWeb.WindowStyle = 7
    $scWeb.Save()

    Write-Host "✓ 1-Click Shortcuts created on Desktop ($d):"
    Write-Host "  · FM AUTO OPS (Desktop App).lnk"
    Write-Host "  · FM AUTO OPS (Web Dashboard).lnk"
  }
}
