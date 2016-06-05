#!/bin/sh

# .bashrc is a special case, since it usually exists. If it's not ours,
# rename it to .bashrc.orig
if [ -L ~/.bashrc ]; then
	echo "OK: No need to remove original .bashrc\n"
else
	echo "INFO: Renaming .bashrc to .bashrc.orig\n"
	mv ~/.bashrc ~/.bashrc.orig
fi

# Installs the softlinks in place.
installrc() {
file=$1
softlink=$2

echo "Installing $file..."

if [ -L $softlink ]; then
	echo "OK: Your $softlink is already a soft link, nice!"
else
	if [ -e $softlink ]; then
		echo "WARNING: You have $softlink - please move it away."
	else
		ln -s ~/.kkrc/$file $softlink
		echo "OK: Installed."
	fi
fi

# Just for pretty formatting
echo
}

installrc .vimrc ~/.vimrc
installrc .vim ~/.vim
installrc .zshrc ~/.zshrc
installrc .screenrc ~/.screenrc
installrc .bashrc ~/.bashrc
installrc .hgrc ~/.hgrc
installrc .tmux.conf ~/.tmux.conf
installrc .gitconfig ~/.gitconfig
installrc .Xmodmap ~/.Xmodmap
installrc .i3 ~/.i3

# Update git submodules
cd ~/.kkrc
if [ -e ~/.kkrc/.vim/bundle/vim-pathogen/README.markdown ]; then
	git submodule foreach git pull origin master
else
	git submodule update --recursive --init
fi
