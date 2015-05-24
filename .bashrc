
# I don't use bash a lot, so this is just the basics.

# If not running interactively, don't do anything
[ -z "$PS1" ] && return

# If there was a .bashrc we moved away at install, run that first
# (so we can override)
if [ -e ~/.bashrc.orig ]; then . ~/.bashrc.orig; fi

# I need VI keys
set -o vi

# Better prompt. Displays user@host, current dir, and job count.
# Uses ANSI bold, since that's color independent (well, mostly).
export PS1="\u@\h \[\033[00;01m\]\w\[\033[00m\] [\j]\$ "
# Or, if ANSI is problematic:
#export PS1="\u@\h \w [\j]\$ "

# Set up some necessary environment variables
export EDITOR=vim
export LC_CTYPE="en_US.UTF-8"

# Set up some handy aliases
alias s="screen -xR"
alias l="ls -lrt"
alias la="ls -lrtA"

# Do we have ZSH? Use it if possible
ZSH=`type -P zsh`
if [ $? -eq 0 ]; then
	exec $ZSH
else
	echo "KKRC: No zsh found, you're on bash."
fi

# Local commands
if [ -e ~/.bashrc.local ]; then . ~/.bashrc.local; fi
