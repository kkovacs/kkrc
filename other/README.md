Other useful config files which are more rarely used.

NOTE: Windows-specific things where moved to `../windows/`.

# firefox.cfg

Firefox `user.js`. Files:

On OS X:
- "/Applications/Firefox.app/Contents/Resources/firefox.cfg"
- "/Applications/Firefox.app/Contents/Resources/defaults/pref/autoconfig.js"
On Linux:
- /usr/lib/firefox/firefox.cfg
- /usr/lib/firefox/defaults/pref/autoconfig.js

NOTE: also requires a "defaults/pref/autoconfig.js":
	pref("general.config.filename", "firefox.cfg");
	pref("general.config.obscure_value", 0);

# gpg-agent.conf

To ~/.gnupg/gpg-agent.conf

# keybindings.json

VSCode keyboard configuration.

On OS X:
	"~/Library/Application Support/Code/User/keybindings.json"

For VIM mode to work properly, you will also need to (see https://github.com/VSCodeVim/Vim#mac):

	defaults write com.microsoft.VSCode ApplePressAndHoldEnabled -bool false

Or disable key repeat globally (also works for neovim-qt):

	defaults write -g ApplePressAndHoldEnabled -bool false

On Linux:
	~/.config/Code/User/keybindings.json

# settings.json

VSCode settings.

On OS X:
	"~/Library/Application Support/Code/User/settings.json"
On Linux:
	~/.config/Code/User/settings.json

# systemd.txt

Create `local@XXX` services for systemd which actually run `/root/start-XXX.sh` shell scripts
