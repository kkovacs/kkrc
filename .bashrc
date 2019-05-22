# I don't use bash a lot, so this is just the basics.

# If not running interactively, don't do anything
[ -z "$PS1" ] && return

# Set up colors
if [ ! -n "$SSH_CLIENT" ] && [ ! -n "$SSH_TTY" ] && [ -z $VIM_TERMINAL ]; then
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
# Colored prompt. Displays user@host, current dir, and job count. Same as KKRC's zsh prompt with RPROMPT turned off. Root detection only on setup.
PS1='\[\033[00;'$([[ `id -u` -eq 0 ]]&&echo -n 31||echo -n 34)'m\]\u\[\033[00m\]@\[\033[00;32m\]\h \[\033[00;33m\]\w \[\033[00;36m\][\j]\[\033[00m\]\$ ';
# Or if you dare to use 256 colors:
#PS1='\[\033[00;'$([[ `id -u` -eq 0 ]]&&echo -n 31||echo -n 34)'m\]\u\[\033[00m\]@\[\033[38;5;39m\]\h \[\033[00;33m\]\w \[\033[00;36m\][\j]\[\033[00m\]\$ ';
# Or, with CONTINUOUS 'root' detection
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
# screen with ssh auth sock transfer, to be used for injection. NOTE: watch out for conflicting session names
#alias s="screen -S kk -X register s \" export SSH_AUTH_SOCK=$SSH_AUTH_SOCK\" ; screen -xR kk"
alias s="screen -xR"
alias l="ls -lrt"
alias la="ls -lrtA -I*" # For Linux
#alias la="ls -lrtd .*" # For stupider systems (OS X, ash, etc), works only in current dir
alias ll="ls -lhSr"
alias lr="ls -AR1 -I .git|awk '/:$/{gsub(/[^\/]+\//,\"--\",\$0);printf(\"%d files\n%s \t\",p-2,\$0);p=0}{p++}END{print p \" files\"}'|less -FX" # Cut -FX in ash
alias bell="printf '\a'" # either echo -ne '\007' or printf '\a'" or tput bel
alias h="history"
alias hc="history -c"
alias psql="INPUTRC=/dev/fd/9 psql 9<<<'set editing-mode vi'";
alias mysql='INPUTRC=/dev/fd/9 mysql 9<<<'\''set editing-mode vi'\'''
# This is getting even uglier, but must have on remote machines
#alias tig='TIGRC_USER=/dev/fd/9 tig 9<<<"set main-options = --all${IFS}set main-view = line-number:no,interval=5 id:yes date:relative author:abbreviated commit-title:yes,graph,refs,overflow=no"'
alias gl="git log --graph --pretty=format:'%Cred%h%Creset -%C(auto)%d%Creset %s %Cgreen(%cr) %C(cyan)<%an>%Creset' --abbrev-commit --date=relative --all --date-order"
alias gs="git status -sb";
alias json="python -mjson.tool"
alias tmux="tmux -2"

# Better systemd. Makes it almost usable, works around some brain-dead-ness.
# - Functions start, reload and restart show the status of how it went, and also tails the log/journal afterwards. Exit tail with CTRL-c.
# - We use $SCS to store (automatically) the unit we're working on, so no need for typing all the time, or history athletics. One rarely works on multiple services at once.
# - We use daemon-reload automatically, because very often the thing you modified for a restart is the unit file.
# - We use reset-failed, because for some incomprehensible reason, the restart-count limit imposed by StartLimitInterval[Sec] also affects manual restarts.

# self-reload, because systemd can't do it on its own...
sdr() { systemctl daemon-reload ; }
# List services, because it should be simple
scl() { systemctl list-units --type service --all ; }
# `sc` is like systemctl, but stores last param in $SCS. Try to set up autocomplete for it, too.
sc() { SCS="${@: -1}" ; systemctl "$@" ; }
complete -F _systemctl sc
# STATUS, but don't trim lines
scs() { SCS="${1:-${SCS}}" ; systemctl status -l "$SCS" ; }
# STOP, but shows a status afterwards
sc0() { SCS="${1:-${SCS}}" ; systemctl stop "$SCS" ; scs ; }
# reusable command to show status afterwards, and tail the log during reload. Exit with CTRL-c
stail() { SCS="${2:-${SCS}}" ; sdr ; systemctl reset-failed "$SCS" ; journalctl -n 0 -xfu "$SCS" & systemctl "$1" "$SCS" ; scs ; fg ; }
# START
sc1() { stail start "${1:-${SCS}}" ; }
# RELOAD
scr() { stail reload-or-restart "${1:-${SCS}}" ; }
# RESTART
scR() { stail restart "${1:-${SCS}}" ; }
# LOG in pager, extended info, jump to end
jc() { SCS="${1:-${SCS}}" ; journalctl -xeu "$SCS" ; }
# LOG "tail -f". Tries to fill the screen.
jcf() { SCS="${1:-${SCS}}" ; journalctl -n "${LINES:-45}" -xefu "$SCS" ; }

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
complete -F _ssh sssh

# Poor man's history expansion (which bash doesn't do on TAB)
#shopt -s histverify
# For "**"
shopt -s globstar
# Spell checking on tab expansion
shopt -s cdspell dirspell
# Set LINES and COLUMNS
shopt -s checkwinsize
# Save multi-line commands as one command
shopt -s cmdhist

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
bind 'set mark-symlinked-directories on';
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
	ssh "$@" -t -- screen -S "${USER}" -X register s \" export SSH_AUTH_SOCK=\$SSH_AUTH_SOCK\" \; screen -xR "${USER}"
}

# Strictly NOT in inject, just LOCAL: open files from vim :term back in VIM.
if [ ! -z $VIM_TERMINAL ]; then
	unalias vim
	function vim() {
		printf '\e]51;["drop", "%s"]\g' "$(realpath "$1")"
	}
	export -f vim
fi

# Display screens if any
screen -ls | grep -v "Socket"

# Local commands
if [ -e ~/.bashrc.local ]; then . ~/.bashrc.local; fi
