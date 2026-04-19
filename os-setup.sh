#!/bin/bash
#
# This script installs some basic software on a number of operating systems.
# Nothing fancy, just basic stuff. Keep it minimal.
#

# Safety
set -e

# Could be an OS X?
if [[ ! -f /etc/os-release && "$(uname -s)" == "Darwin" ]]; then
	# Install brew if needed
	type -p brew || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
	brew update
	brew install bash bash-completion coreutils ctags curl git gnu-sed htop neovim pwgen socat telnet tig tmux vim watch wget
	exit 0 # Don't execute the Linux parts
fi

# Load environment
. /etc/os-release

# See which Linux
if [[ $ID_LIKE == "debian" ]]; then
	# Update packages (wait if needed)
	until sudo apt-get update; do sleep 1; done
	# Install packages (wait if needed)
	until sudo NEEDRESTART_MODE=a apt-get install -y bash-completion curl dnsutils git htop less less man psmisc rsync screen socat tig unattended-upgrades unzip vim-nox wget zip; do sleep 1; done;
elif [[ $ID_LIKE == *"fedora"* ]]; then # Covers Fedora, RedHat, CentOS, Alma Linux, Oracle Linux
	sudo yum install -y epel-release && sudo yum install -y bash-completion bind-utils curl git htop less psmisc rsync screen socat tig unzip util-linux vim wget zip
elif [[ $ID_LIKE == *"suse"* ]]; then
	sudo zypper install -y bash-completion bind-utils curl git htop less psmisc rsync screen socat tig unzip util-linux vim wget zip
elif [[ $ID == "alpine" ]]; then
	sudo apk add bash-completion bind-tools curl git htop less psmisc rsync screen socat tig unzip vim wget zip
else
	echo "Unknown OS - can't setup!"
	exit 1
fi

# Exit with success
exit 0
