# Creates Single 1-Click Desktop Shortcut for FM AUTO OPS with custom icon and smart launcher

$desktopPaths = @(
  "D:\OneDrive\Máy tính",
  [Environment]::GetFolderPath("Desktop"),
  "C:\Users\$env:USERNAME\Desktop"
) | Select-Object -Unique

$wshShell = New-Object -ComObject WScript.Shell
$iconPath = "d:\tool auto\FM-AUTO-OPS\assets\app-icon.ico,0"
$vbsPath = "d:\tool auto\FM-AUTO-OPS\FM_AUTO_OPS.vbs"

foreach ($d in $desktopPaths) {
  if (Test-Path $d) {
    # Remove older redundant shortcuts
    @("FM AUTO OPS (Desktop App).lnk", "FM AUTO OPS (Web Dashboard).lnk") | ForEach-Object {
      $old = Join-Path $d $_
      if (Test-Path $old) { Remove-Item $old -Force }
    }

    # Create the single primary shortcut
    $lnk = Join-Path $d "FM AUTO OPS.lnk"
    $sc = $wshShell.CreateShortcut($lnk)
    $sc.TargetPath = "wscript.exe"
    $sc.Arguments = "`"$vbsPath`""
    $sc.WorkingDirectory = "d:\tool auto\FM-AUTO-OPS"
    $sc.IconLocation = $iconPath
    $sc.Description = "FM AUTO OPS — Enterprise Procurement & RPA Tool"
    $sc.WindowStyle = 1
    $sc.Save()

    Write-Host "Created single 1-click shortcut: $lnk"
  }
}
