#!/bin/sh

# update.sh basically just updates the .kkrc dir from github, then starts
# install.sh.  Why is it separated in two then? So if install.sh itself had a
# new version, the new versoin gets executed.

echo "Pulling from git..."
cd ~/.kkrc
git pull --recurse-submodules
echo "...updating submodules..."
git submodule update --recursive
echo "...done."
echo

exec ./install.sh
