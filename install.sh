#!/bin/bash

# Change to own dir
cd "$(dirname $0)"

# .bashrc is a special case, since it usually exists. If it's not ours,
# rename it to .bashrc.orig
printf "Installing .bashrc: "
if [ -L ~/.bashrc ]; then
	printf "\033[00;32mOK:\033[00m No need to remove original .bashrc\n"
else
	printf "\033[00;33mINFO:\033[00m Renaming .bashrc to .bashrc.orig\n"
	mv ~/.bashrc ~/.bashrc.orig
fi

# Installs the softlinks in place.
process() {
	local file="$1"
	local softlink="$2"

	printf "Installing $file: "

	if [ -L "$softlink" ]; then
		printf "\033[00;32mOK:\033[00m Your $softlink is already a soft link, nice!\n"
	else
		if [ -e "$softlink" ]; then
			printf "\033[00;31mWARNING: You have $softlink - please move it away.\033[00m\n"
		else
			# NOTE: No quotes on first param or ~ expansion not always happens
			ln -s ~/.kkrc/$file "$softlink"
			printf "\033[00;32mOK:\033[00m Installed.\n"
		fi
	fi
}

# Process all files/dirs
. ./kkrc-files

# Update git submodules
echo "Updating git submodules:"
if [ -e ~/.kkrc/.vim/pack/kkrc/start/vim-sensible/README.markdown ]; then
	git submodule update --remote --merge
else
	git submodule update --init
	# XXX Not using --recursive for now, because we don't need vim plugins' test-subrepos and stuff.
	#WAS: git submodule update --recursive --init
fi
