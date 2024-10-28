REM Install winget in case it's missing
WHERE winget.exe
IF %ERRORLEVEL% NEQ 0 powershell.exe -Command "& {Add-AppxPackage https://github.com/microsoft/winget-cli/releases/latest/download/Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle}"

REM Update information
winget.exe update

REM Install stuff that requires administrator
winget.exe install Microsoft.WindowsTerminal
winget.exe install vim.vim
winget.exe install Neovim.Neovim
winget.exe install Git.Git

REM Install stuff that can be installed on the user-level
winget.exe install Microsoft.PowerToys --scope user
winget.exe install Microsoft.VisualStudioCode --scope user
winget.exe install DuckDB.cli --scope user
winget.exe install DuckDuckGo.DesktopBrowser --scope user
winget.exe install MullvadVPN.MullvadBrowser --scope user

REM Install OpenSSH - special case
winget.exe install Microsoft.OpenSSH.Beta
REM Stop and disable OpenSSH server
powershell.exe -Command "& {Start-Process powershell -Verb runAs -ArgumentList ('& {Stop-Service \'sshd\' ; Set-Service -StartupType Disabled \'sshd\'}') }"
