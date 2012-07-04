
# I don't use bash a lot, so this is just the basics.

# If not running interactively, don't do anything
[ -z "$PS1" ] && return

# I need VI keys
set -o vi

# Screen quickstart, the most important alias
alias s="screen -UxRR"

# Do we have ZSH? Use it if possible
ZSH=`type -P zsh`
if [ $? -eq 0 ]; then
	exec $ZSH
else
	echo "KKRC: No zsh found, you're on bash."
fi

# Local commands:
