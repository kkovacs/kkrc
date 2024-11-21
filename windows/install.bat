REM Install winget in case it's missing
WHERE winget.exe
IF %ERRORLEVEL% NEQ 0 powershell.exe -Command "& {Add-AppxPackage https://github.com/microsoft/winget-cli/releases/latest/download/Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle}"

REM Update winget packages information
winget.exe update

REM Install software that requires administrator
winget.exe install Microsoft.WindowsTerminal
winget.exe install vim.vim
winget.exe install Neovim.Neovim
winget.exe install Git.Git
winget.exe install MullvadVPN.MullvadBrowser
winget.exe install WinScp.WinScp

REM Install software that can be installed on the user-level
winget.exe install --scope user Microsoft.PowerToys
winget.exe install --scope user Microsoft.VisualStudioCode
winget.exe install --scope user DuckDB.cli
winget.exe install --scope user DuckDuckGo.DesktopBrowser

REM Install OpenSSH - special case
winget.exe install Microsoft.OpenSSH.Beta
REM Stop and disable the installed OpenSSH server, we only need the agent
powershell.exe -Command "& {Start-Process powershell -Verb runAs -ArgumentList ('& {Stop-Service sshd ; Set-Service -StartupType Disabled sshd}') }"

REM Import registry entries
reg.exe import scancodemap-ultimate.reg
reg.exe import Open_File_Explorer_to_Downloads.reg
