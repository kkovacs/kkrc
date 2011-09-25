#!/bin/sh

# update.sh basically just updates the .kkrc dir from github, then starts
# install.sh.  Why is it separated in two then? So if install.sh itself had a
# new version, the new versoin gets executed.

echo "Updating from git..."
cd ~/.kkrc
git pull
echo "...done."
echo

exec ./install.sh
