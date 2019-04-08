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

# Disable Debian/Ubuntu's annoying "command not found" script
unset -f command_not_found_handle

# Disable history
unset HISTFILE

# Clear out other people's stupid history from my session
#history -c

# Make history show date and time
HISTTIMEFORMAT="%F %T "

# NOTE: We're not exporting the prompt: this is important especially in tmux
# inject.  This is because in a subshell, other important things (most
# notably HISTFILE, aliases, etc) are NOT exported anyway or might be
# overwritten, and the plain prompt is a reminder that the environment is NOT
# fully set up.
#
# Colored prompt. Displays user@host, current dir, and job count. Same as KKRC's zsh prompt with RPROMPT turned off.
PS1='\[\033[00;'$([[ `id -u` -eq 0 ]]&&echo -n 31||echo -n 34)'m\]\u\[\033[00m\]@\[\033[00;32m\]\h \[\033[00;33m\]\w \[\033[00;36m\][\j]\[\033[00m\]\$ ';
# Colored prompt with continuous 'root' detection
#PROMPT_COMMAND="PS1='\[\033[00;\$([[ `id -u` -eq 0 ]]&&echo -n 31||echo -n 34)m\]\u\[\033[00m\]@\[\033[00;32m\]\h \[\033[00;33m\]\w \[\033[00;36m\][\j]\[\033[00m\]\\$ '"
# Or, if ANSI is problematic:
#PS1="\u@\h \w [\j]\$ "

# "bell" before prompt. Separated from PS1 so it's easier to turn off when needed,
# and at least clears any erroneous local PROMPT_COMMAND.
export PROMPT_COMMAND="printf '\a'"

# Set up some necessary environment variables
export EDITOR=vim
export PAGER=less
export LC_ALL="en_US.UTF-8"
export LANG="en_US.UTF-8"
export LESSHISTFILE=/dev/null;

# Colors! :)
export CLICOLOR=1
# BSD colors
export LSCOLORS=ExFxCxDxBxegedabagacad
# Linux colors -- set always because of zsh's list-colors
export LS_COLORS="di=1;34:ln=1;35:so=1;32:pi=1;33:ex=1;31:bd=34;46:cd=34;43:su=30;41:sg=30;46:tw=30;42:ow=30;43"

# Most useful quoting style
export QUOTING_STYLE=shell-escape

# FOR INJECT: Lighter vim
#export VIMINIT=":set nobackup noswapfile encoding=utf8 viminfo="
alias vim="vim -n -i NONE" # No swapfile, no viminfo

# Set up some handy aliases
alias s="screen -xR"
alias l="ls -lrt"
alias la="ls -lrtA -I*" # For Linux
#alias la="ls -lrtd .*" # For stupider systems (OS X, ash, etc), works only in current dir
alias ll="ls -lhSr"
alias lr="ls -AR1|awk '/:$/{gsub(/[^\/]+\//,\"--\",\$0);printf(\"%d files\n%s \t\",p-2,\$0);p=0}{p++}END{print p \" files\"}'|less -FX" # Cut -FX in ash
alias bell="printf '\a'" # either echo -ne '\007' or printf '\a'" or tput bel
alias h="history"
alias hc="history -c"
alias sc="systemctl"
alias jc="journalctl"
alias scs="systemctl status"
alias sc0="systemctl stop"
alias sc1="systemctl start"
alias scr="systemctl restart"
alias psql="INPUTRC=/dev/fd/9 psql 9<<<'set editing-mode vi'";
alias mysql='INPUTRC=/dev/fd/9 mysql 9<<<'\''set editing-mode vi'\'''
# This is getting even uglier, but must have on remote machines
#alias tig='TIGRC_USER=/dev/fd/9 tig 9<<<"set main-options = --all${IFS}set main-view = line-number:no,interval=5 id:yes date:relative author:abbreviated commit-title:yes,graph,refs,overflow=no"'
alias gl="git log --graph --pretty=format:'%Cred%h%Creset -%C(auto)%d%Creset %s %Cgreen(%cr) %C(cyan)<%an>%Creset' --abbrev-commit --date=relative --all --date-order"
alias gs="git status -sb";
alias json="python -mjson.tool"
alias tmux="tmux -2"
# Only if not on busybox
[ -L $(type -p grep) ] || alias grep="grep --color"
[ -L $(type -p less) ] || alias less="less -X" # No alt screen

# OS X specifics
if [[ "$OSTYPE" == "darwin"* ]]; then
	# If we have `brew install coreutils`, then use the linux-compatible `ls`
	[ -f /usr/local/bin/gls ] && alias ls="gls --color"
fi

# Now fix bash competion for our systemd aliases (unfortunately manually)
# NOTE: unfortunately there is no way in bash to also autocomplete "scs", "sc0"... :(
[ -f /usr/share/bash-completion/bash_completion ] && . /usr/share/bash-completion/bash_completion # Most Linux
[ -f /usr/local/etc/bash_completion ] && . /usr/local/etc/bash_completion # OS X
if type _completion_loader 2>/dev/null >/dev/null; then _completion_loader systemctl; _completion_loader journalctl; fi
complete -F _systemctl sc
complete -F _journalctl jc
complete -F _ssh sssh

# Poor man's history expansion (which bash doesn't do on TAB)
#shopt -s histverify
# For "**"
shopt -s globstar
# Spell checking on tab expansion
shopt -s cdspell dirspell
# Set LINES and COLUMNS
shopt -s checkwinsize

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
bind 'set history-preserve-point off'
# History expansion on space
bind 'space:magic-space'

# Better history stepping, both in insert and command mode
# HACK: Assigning functions to non-existent keys, so a few lines down we can do two things on one keypress. This is all about the jump to end-of-line
bind -m vi '"\200":previous-history'
bind -m vi '"\201":next-history'
bind -m vi '"\202":end-of-line'
bind -m vi 'k:"\200\202"'
bind -m vi 'j:"\201\202"'
bind -m vi '"\e[A":"\200\202"'
bind -m vi '"\e[B":"\201\202"'
bind -m vi-insert '"\e[A":history-search-backward'
bind -m vi-insert '"\e[B":history-search-forward'
# And I still want CTRL-L in insert mode
bind -m vi-insert "\C-l":clear-screen

# Restore default completion for cd, since bash-completion doesn't handle wildcards
compopt -o bashdefault cd

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
	# Restore from alternate mode, if set
	printf '\e[?47l'
}

# SSH with automatic GNU screen on the other side
sssh() {
	ssh "$@" -t -- screen -xR "${USER}"
}

# Display screens if any
screen -ls | grep -v "Socket"

# Local commands
if [ -e ~/.bashrc.local ]; then . ~/.bashrc.local; fi
