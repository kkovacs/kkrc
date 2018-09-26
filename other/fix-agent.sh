#launchctl setenv SSH_ASKPASS /usr/local/bin/ssh-askpass
export SSH_ASKPASS=/usr/local/bin/ssh-askpass
eval `ssh-agent`
ssh-add -c
