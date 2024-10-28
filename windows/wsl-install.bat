REM V1 is not running in a real VM, but is apparently problematic.
wsl.exe --set-default-version 1
REM Install the default Ubuntu
wsl.exe --install
REM Let's see what we ended up with
wsl.exe --list -v
