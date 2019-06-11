#!/bin/bash

# NOTE: Bash minifier belongs to: https://github.com/precious/bash_minifier

# CD into own dir, for relative file access
cd "$(dirname $0)"

# Enable ignore-lines-with-starting-space feature, while making as little a mess as possible.
# Start with an "i" and a "DEL", in case remote is in VI-command mode.
# Also, insert a starting space for the next wall-of-text.
printf 'i\x7f HISTCONTROL=ignoreboth\r ' >../inject-bash.txt
# Minify .bashrc's content between the two marker lines.
# XXX: The `sed` command is there to fix a "-bash: [: missing `]'" error.
cat ../.bashrc | awk '/START of part to be injected/{on=1} {if (on) { print $0 }} /END of part to be injected/{on=0}' | python minifier.py | sed -e 's/)]/) ]/g' >>../inject-bash.txt
# Add ENTER to minified wall-of-text, add commands for getting a quick status of the remote machine, then a final ENTER.
printf '\r uptime;free -m;cat /etc/os-release;h 10;screen -ls 2>/dev/null;echo $SSH_AUTH_SOCK\r' >>../inject-bash.txt
