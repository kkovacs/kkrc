# I don't use bash a lot, so this is just the basics.

# If not running interactively, don't do anything
[ -z "$PS1" ] && return

# Set up colors
if [ ! -n "$SSH_CLIENT" ] && [ ! -n "$SSH_TTY" ]; then
	BASE16_SHELL="$HOME/.kkrc/base16-colors.dark.sh"
	[[ -s $BASE16_SHELL ]] && source $BASE16_SHELL
fi

# If there was a .bashrc we moved away at install, run that first
# (so we can override)
if [ -e ~/.bashrc.orig ]; then . ~/.bashrc.orig; fi

# I need VI keys
set -o vi

# Colored prompt. Displays user@host, current dir, and job count. Same as KKRC's zsh prompt with RPROMPT turned off.
export PS1="\[\033[00;34m\]\u\[\033[00m\]@\[\033[00;32m\]\h\[\033[00m\] \[\033[00;33m\]\w\[\033[00m\] \[\033[00;36m\][\j]\[\033[00m\]\$ "
# Or, if ANSI is problematic:
#export PS1="\u@\h \w [\j]\$ "

# Set up some necessary environment variables
export EDITOR=vim
export LC_CTYPE="en_US.UTF-8"

# BSD colors
export LSCOLORS=ExFxCxDxBxegedabagacad
# Linux colors -- set always because of zsh's list-colors
export LS_COLORS="di=1;34:ln=1;35:so=1;32:pi=1;33:ex=1;31:bd=34;46:cd=34;43:su=30;41:sg=30;46:tw=30;42:ow=30;43"

# Set up some handy aliases
alias s="screen -xR"
alias l="ls -lrt"
alias la="ls -lrtA"
alias ll="ls -lhFrt"
alias grep="grep --color"
alias json="python -mjson.tool"
alias kargs="xargs -P `getconf _NPROCESSORS_ONLN` -I%"
alias tmux="TERM=xterm-256color tmux"

# Do we have ZSH? Use it if possible
ZSH=`type -P zsh`
if [ $? -eq 0 ]; then
	exec $ZSH
else
	echo "KKRC: No zsh found, you're on bash."
fi

# Display screens if any
screen -ls | grep -v "Socket"

# Local commands
if [ -e ~/.bashrc.local ]; then . ~/.bashrc.local; fi
