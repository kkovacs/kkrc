#!/bin/sh

# Change to own dir
cd "$(dirname $0)"

# .bashrc is a special case, since it usually exists. If it's not ours,
# rename it to .bashrc.orig
if [ -L ~/.bashrc ]; then
	echo "OK: No need to remove original .bashrc\n"
else
	echo "INFO: Renaming .bashrc to .bashrc.orig\n"
	mv ~/.bashrc ~/.bashrc.orig
fi

# Installs the softlinks in place.
process() {
	local file="$1"
	local softlink="$2"

	echo "Installing $file..."

	if [ -L "$softlink" ]; then
		echo "OK: Your $softlink is already a soft link, nice!"
	else
		if [ -e "$softlink" ]; then
			echo "WARNING: You have $softlink - please move it away."
		else
			ln -s "~/.kkrc/$file" "$softlink"
			echo "OK: Installed."
		fi
	fi

	# Just for pretty formatting
	echo
}

# Process all files/dirs
. ./kkrc-files

# Update git submodules
if [ -e ~/.kkrc/.vim/bundle/vim-pathogen/README.markdown ]; then
	git submodule foreach git pull origin master
else
	git submodule update --recursive --init
fi
