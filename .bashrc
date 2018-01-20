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

# START of part to be injected

# Ignore both duplicated and whitespace
HISTCONTROL=ignoreboth

# I need VI keys
set -o vi

# Disable history
unset HISTFILE

# Colored prompt. Displays user@host, current dir, and job count. Same as KKRC's zsh prompt with RPROMPT turned off.
#export PS1='\[\033[00;34m\]\u\[\033[00m\]@\[\033[00;32m\]\h\[\033[00m\] \[\033[00;33m\]\w\[\033[00m\] \[\033[00;36m\][\j]\[\033[00m\]\$ '
# Colored prompt with 'root' detection
export PROMPT_COMMAND="PS1='\[\033[00;\$([[ `id -u` -eq 0 ]]&&echo -n 31||echo -n 34)m\]\u\[\033[00m\]@\[\033[00;32m\]\h\[\033[00m\] \[\033[00;33m\]\w\[\033[00m\] \[\033[00;36m\][\j]\[\033[00m\]\\$ '"
# Or, if ANSI is problematic:
#export PS1="\u@\h \w [\j]\$ "

# Set up some necessary environment variables
export EDITOR=vim
export PAGER=less
export LC_CTYPE="en_US.UTF-8"
export LANG="en_US.UTF-8"

# Colors! :)
export CLICOLOR=1
# BSD colors
export LSCOLORS=ExFxCxDxBxegedabagacad
# Linux colors -- set always because of zsh's list-colors
export LS_COLORS="di=1;34:ln=1;35:so=1;32:pi=1;33:ex=1;31:bd=34;46:cd=34;43:su=30;41:sg=30;46:tw=30;42:ow=30;43"

# Set up some handy aliases
alias s="screen -xR"
alias l="ls -lrt"
alias la="ls -lrtA"
alias ll="ls -lhFrt"
alias h="history"
alias sc="systemctl"
alias jc="journalctl"
alias scs="systemctl status"
alias sc0="systemctl stop"
alias sc1="systemctl start"
alias scr="systemctl restart"
alias gl="git log --graph --pretty=format:'%Cred%h%Creset -%C(auto)%d%Creset %s %Cgreen(%cr) %C(cyan)<%an>%Creset' --abbrev-commit --date=relative --all --date-order"
alias gs="git status -sb";
alias json="python -mjson.tool"
alias tmux="tmux -2"
# Only if not on busybox
[ -h $(type -p grep) ] || alias grep="grep --color"
[ -h $(type -p less) ] || alias less="less -X" # No alt screen

# Now fix bash competion for our systemd aliases (unfortunately manually)
# NOTE: unfortunately there is no way in bash to also autocomplete "scs", "sc0"... :(
[ -f /usr/share/bash-completion/bash_completion ] && . /usr/share/bash-completion/bash_completion # Most Linux
[ -f /usr/local/etc/bash_completion ] && . /usr/local/etc/bash_completion # OS X
_completion_loader systemctl
_completion_loader journalctl
complete -F _systemctl sc
complete -F _journalctl jc

# Poor man's history expansion (which bash doesn't do on TAB)
shopt -s histverify
# For "**"
shopt -s globstar
# Spell checking on tab expansion
shopt -s cdspell dirspell

# Configure readline
bind 'TAB:menu-complete'
bind '"\e[Z": menu-complete-backward'
bind 'set menu-complete-display-prefix on'
bind 'set show-all-if-ambiguous on'
bind 'set completion-ignore-case on'
bind 'set match-hidden-files off'
bind 'set colored-stats on'
bind 'set visible-stats on'
bind 'set completion-prefix-display-length 1'
bind 'set skip-completed-text on'
bind 'set history-preserve-point on'

# Better history stepping, both in insert and command mode
bind -m vi 'k:history-search-backward'
bind -m vi 'j:history-search-forward'
bind -m vi '"\e[A":history-search-backward'
bind -m vi '"\e[B":history-search-forward'
bind -m vi-insert '"\e[A":history-search-backward'
bind -m vi-insert '"\e[B":history-search-forward'
# And I still want CTRL-L in insert mode
bind -m vi-insert "\C-l":clear-screen

# END of part to be injected

# hl - highlight command
source ~/.kkrc/hl
export -f hl

# Automatically set TMUX window title on SSH
ssh() {
	# Store current window name
	local SAVED=$(tmux display-message -p '#W')
	local ARGS=($@)
	local NAME="ssh"
	local I
	# Try to find the server name
	for I in ${ARGS} ; do
		[[ $I == "--" ]] && break
		NAME="$I"
	done
	# Set window name
	tmux rename-window "${NAME}" >/dev/null 2>/dev/null
	# Do it
	command ssh "$@"
	# To Restore window name automatically:
	#tmux rename-window "$SAVED" >/dev/null 2>/dev/null
	# To switch back to auto-renaming after disconnection:
	#tmux set-window-option automatic-rename "on" >/dev/null 2>/dev/null
}

# Display screens if any
screen -ls | grep -v "Socket"

# Local commands
if [ -e ~/.bashrc.local ]; then . ~/.bashrc.local; fi
