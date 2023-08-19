Other useful config files which are more rarely used.

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

# apple-like-us-abc-extended-keyboard.klc

Windows keyboard layout similar to MacOS's "ABC Extended" (was "US Extended")
keyboard, regarding my language's accented characters.

To be used with Microsoft Keyboard Layout Creator (MSKLC) from:
https://www.microsoft.com/en-us/download/details.aspx?id=102134

It's not a perfect match because I can set up "dead key" accents only on AltGr.
Because of this, I also use Microsoft PowerToys to redefine for example WIN+E
to AltGr+E, etc.

An alternative is to use the "Romanian (Developer)" keyboard, which is
basically US but has all the dead keys, even if in wrong places. That can be
fixed with Microsoft PowerToys though.

# scancodemap-swap-altl-winl.reg

Windows registry file to swap the left Alt and the left Win keys, so they match
MAC layout which I'm more used to.
