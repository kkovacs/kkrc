Other useful config files which are more rarely used.

# keybindings.json

VSCode keyboard configuration.

On OS X:
	"~/Library/Application Support/Code/User/keybindings.json"
On Linux:
	~/.config/Code/User/keybindings.json

# settings.json

VSCode settings.

On OS X:
	"~/Library/Application Support/Code/User/settings.json"
On Linux:
	~/.config/Code/User/settings.json

# firefox.cfg

Firefox `user.js`.

On OS X:
	"/Applications/Firefox.app/Contents/Resources/firefox.cfg"

NOTE: also requires a "defaults/pref/autoconfig.js":
	pref("general.config.filename", "firefox.cfg");
	pref("general.config.obscure_value", 0);

On OS X:
	"/Applications/Firefox.app/Contents/Resources/defaults/pref/autoconfig.js"

# systemd.txt

Create `local@XXX` services for systemd which actually run `/root/start-XXX.sh` shell scripts

# AutohotKey.ahk

Windows accents config to be used with https://www.autohotkey.com/
