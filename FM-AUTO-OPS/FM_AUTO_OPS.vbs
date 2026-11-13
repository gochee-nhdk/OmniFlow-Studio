Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "d:\tool auto\FM-AUTO-OPS\apps\local-agent"
WshShell.Run "cmd /c npx electron dist/main/index.js", 0, False
