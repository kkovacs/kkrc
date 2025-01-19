#!/bin/sh
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
	brew install bash bash-completion coreutils ctags curl git gnu-sed htop lftp pinentry-mac pwgen socat telnet tig tmux vim watch wget
	exit 0 # Don't execute the Linux parts
fi

# Load environment
. /etc/os-release

# See which Linux
if [[ $ID_LIKE == "debian" ]]; then
	# Update packages (wait if needed)
	until sudo apt-get update; do sleep 1; done
	# Install packages (wait if needed)
	until sudo NEEDRESTART_MODE=a apt-get install -y less man less psmisc screen htop curl wget bash-completion dnsutils git tig socat rsync zip unzip vim-nox unattended-upgrades; do sleep 1; done;
elif [[ $ID_LIKE == *"fedora"* ]]; then # Covers Fedora, RedHat, CentOS, Alma Linux, Oracle Linux
	sudo yum install -y epel-release && sudo yum install -y less psmisc screen htop curl wget bash-completion bind-utils util-linux git tig socat rsync vim zip unzip
elif [[ $ID_LIKE == *"suse"* ]]; then
	sudo zypper install -y less psmisc screen htop curl wget bash-completion bind-utils util-linux git tig socat rsync vim zip unzip
elif [[ $ID == "alpine" ]]; then
	sudo apk add less psmisc screen htop curl wget bash-completion bind-tools git tig socat rsync zip unzip vim
else
	echo "Unknown OS - can't setup!"
	exit 1
fi

# Exit with success
exit 0
