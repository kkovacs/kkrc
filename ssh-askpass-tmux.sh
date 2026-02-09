#!/bin/bash

# To use, call this script from .bashrc.local:
# source ~/.kkrc/ssh-askpass-tmux.sh

# Called without params means we're installing.
if [[ "$#" -eq 0 ]]; then
    if [[ -z $SSH_AUTH_SOCK ]]; then
        # Start ssh-agent in background, using the right variables
        eval `DISPLAY=dummy SSH_ASKPASS="$HOME/.kkrc/ssh-askpass-tmux.sh" ssh-agent`
    fi
    # Add with "confirm" option (this makes this work)
    ssh-add -l >/dev/null || echo 'NOTE: Run "ssh-add -c" to add keys!'
    return
elif [[ "$1" == "popup" ]]; then
    # Colors!
    printf "\033[1;36m%s\n\n" "$MSG"
    printf "\033[1;33m" "$MSG"
    read -p "To confirm type 'ok' " -s -n 2
    printf "\033[0m\n"
    # Did the user agree?
    [[ $REPLY == "ok" ]]
    exit $?
fi

# Called as $SSH_AGENT
tmux display-popup -y P -h 7 -e MSG="$1" -E "$HOME/.kkrc/ssh-askpass-tmux.sh popup"
