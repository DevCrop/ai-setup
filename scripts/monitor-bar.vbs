' Runs scripts\monitor-bar.ps1 with no console window. The Startup shortcut made by scripts\monitor-install.ps1 points here.
Set fs = CreateObject("Scripting.FileSystemObject")
ps1 = fs.BuildPath(fs.GetParentFolderName(WScript.ScriptFullName), "monitor-bar.ps1")
CreateObject("WScript.Shell").Run "powershell -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """", 0, False
