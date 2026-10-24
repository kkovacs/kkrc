#!/bin/bash
# Load age-encrypted KEY=value lines into the tmux global env, hidden (-h).
# Goes through "tmux set-environment", NOT the tmux parser, so values stay verbatim.
set -eu

age -i ~/.ssh/age.key -d ~/.ssh/env.age | while IFS= read -r line; do
	# Skip blank lines and comments
	[[ $line =~ ^[[:space:]]*(#|$) ]] && continue
	# Fail fast on anything that is not KEY=value
	[[ $line =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || { echo "Bad line (no KEY=value)" >&2; exit 1; }
	tmux set-environment -h "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
done
