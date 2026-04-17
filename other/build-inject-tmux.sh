#!/bin/bash

# NOTE: Bash minifier belongs to: https://github.com/precious/bash_minifier

# CD into own dir, for relative file access
cd "$(dirname $0)"

# Start with an "i" and a "DEL", in case remote is in VI-command mode.
# Also, insert a starting space for the next wall-of-text.
printf 'i\x7f tmux ' >../inject-tmux.txt
# Process .tmux.screen
awk 'BEGIN {line=""} /^#/ || /^$/ {next} {if (line=="") line=$0; else line=line " \\; " $0} END {print line}' ../.tmux.screen >>../inject-tmux.txt
