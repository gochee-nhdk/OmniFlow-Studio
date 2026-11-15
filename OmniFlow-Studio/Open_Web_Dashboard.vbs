Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "d:\tool auto\FM-AUTO-OPS"
WshShell.Run "node scripts/serve.mjs", 0, False
