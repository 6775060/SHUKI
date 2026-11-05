' Runs the launcher with no console window. Arguments are passed through.
Set shell = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
args = ""
For Each a In WScript.Arguments
  args = args & " " & a
Next
shell.Run """" & dir & "\node\node.exe"" """ & dir & "\launcher.mjs""" & args, 0, False
