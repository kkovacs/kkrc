# install.bat

Install mandatory (for me) software from winget.

Often it's better to download the latest winget installer manually before
running `install.bat`: https://aka.ms/getwinget

Not recommended, but from Powershell (this requires other DLLs to install
separately -- because on Windows apparently you need to install a UI library for
your command line tool...):

```powershell
Add-AppxPackage https://github.com/microsoft/winget-cli/releases/latest/download/Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle
```

# scancodemap-ultimate.reg

Scancode map that does:

- Sets Caps Lock to Right Ctrl.
- Sets Left Win to Right Alt.
- Sets Menu to Left Win. (In case there is no Right Win button and we still need the functionality.)

More info: <https://github.com/Lamer87/Keyboard_ScanCodes_for_remapping>

# scancodemap-caps-lock-to-ctrl.reg

This registry file only replaces Caps Lock with Right Ctrl.

# Open_File_Explorer_to_Downloads.reg

This registry file makes Windows Explorer open the "Downloads" folder instead
of whatever when a new window is opened.
