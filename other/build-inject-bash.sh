#!/bin/bash

# NOTE: Bash minifier belongs to: https://github.com/precious/bash_minifier

# CD into own dir, for relative file access
cd "$(dirname $0)"

# Enable ignore-lines-with-starting-space feature, while making as little a mess as possible.
# Start with an "i" and a "DEL", in case remote is in VI-command mode.
# Also, insert a starting space for the next wall-of-text.
printf 'i\x7f HISTCONTROL=ignoreboth\r clear;' >../inject-bash.txt
# Minify .bashrc's content between the two marker lines.
cat ../.bashrc | awk '/START of part to be injected/{on=1} {if (on) { print $0 }} /END of part to be injected/{on=0}' | python3 minifier.py >>../inject-bash.txt
# Add ENTER to minified wall-of-text, add commands for getting a quick status of the remote machine, then a final ENTER.
printf '\r grep PRETTY_NAME /etc/os-release;uname -prinsm;uptime;free -mwt;h 11;screen -ls 2>/dev/null;systemd-detect-virt;echo $SSH_AUTH_SOCK\r' >>../inject-bash.txt
