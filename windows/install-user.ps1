# Install winget in case it's missing
Add-AppxPackage https://github.com/microsoft/winget-cli/releases/latest/download/Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle

# Install stuff that requires administrator
winget.exe update
winget.exe install Microsoft.WindowsTerminal
winget.exe install vim.vim
winget.exe install Neovim.Neovim

# Install stuff that can be installed on the user-level
winget.exe install Microsoft.PowerToys --scope user
winget.exe install Microsoft.VisualStudioCode --scope user
winget.exe install Git.Git --scope user
winget.exe install DuckDB.cli --scope user
winget.exe install DuckDuckGo.DesktopBrowser --scope user
winget.exe install MullvadVPN.MullvadBrowser --scope user
