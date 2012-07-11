
# I don't use bash a lot, so this is just the basics.

# If not running interactively, don't do anything
[ -z "$PS1" ] && return

# I need VI keys
set -o vi

# Better prompt. Displays user@host, current dir, and job count.
# Uses ANSI bold, since that's color independent (well, mostly).
export PS1="\u@\h \033[00;01m\w\033[00m [\j]\$ "
# Or, if ANSI is problematic:
#export PS1="\u@\h \w [\j]\$ "

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
