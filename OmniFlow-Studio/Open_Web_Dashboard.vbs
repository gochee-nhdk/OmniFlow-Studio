Set shell = CreateObject("WScript.Shell")
scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
command = "node """ & scriptDir & "\scripts\serve.mjs"""
shell.CurrentDirectory = scriptDir
shell.Run command, 0, False
