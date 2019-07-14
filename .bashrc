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

# Ignore both duplicated and whitespace
# (This is inserted separately to the front of the the inject file)
HISTCONTROL=ignoreboth

# OS X specifics, before
if [[ "$OSTYPE" == "darwin"* ]]; then
	# Force load bash-completion on OS X
	# We need to do this BEFORE the generic part, or else `compopt` is unknown
	[ -f /usr/local/etc/bash_completion ] && . /usr/local/etc/bash_completion
	# If we have `brew install coreutils`, then use the linux-compatible `ls`
	# NOTE: Have this before defining `lll`, so that uses gls too
	[ -f /usr/local/bin/gls ] && alias ls="gls --color"
fi

# START of part to be injected

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
PS1='\[\033[00;'$([[ "$UID" -eq 0 ]]&&echo -n 31||echo -n 34)'m\]\u\[\033[00m\]@\[\033[00;32m\]\h \[\033[00;33m\]\w \[\033[00;36m\][\j]\[\033[00m\]\$ '
# Or if you dare to use 256 colors:
#PS1='\[\033[00;'$([[ "$UID" -eq 0 ]]&&echo -n 31||echo -n 34)'m\]\u\[\033[00m\]@\[\033[38;5;39m\]\h \[\033[00;33m\]\w \[\033[00;36m\][\j]\[\033[00m\]\$ '
# Or, with CONTINUOUS 'root' detection
#PROMPT_COMMAND="PS1='\[\033[00;\$([[ "$UID" -eq 0 ]]&&echo -n 31||echo -n 34)m\]\u\[\033[00m\]@\[\033[00;32m\]\h \[\033[00;33m\]\w \[\033[00;36m\][\j]\[\033[00m\]\\$ '"
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
export LESSHISTFILE=/dev/null

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
# No swapfile, no viminfo
alias vim="vim -n -i NONE"

# Set up some handy aliases
# screen with ssh auth sock transfer, to be used for injection. NOTE: watch out for conflicting session names
#alias s="screen -S kk -X register s \" export SSH_AUTH_SOCK=$SSH_AUTH_SOCK\" ; screen -xR kk"
alias s="screen -xR"
alias l="ls -lrt"
alias la="ls -lrtA -I*" # For Linux
#alias la="ls -lrtd .*" # For stupider systems (OS X, ash, etc), works only in current dir
alias ll="ls -lrtA"
# A version of ls/ll that is still quick to type, but uses less automatically
lll() { ls -lrtA --color "$@" | less -FXRn +G ; }
#alias lr="ls -AR1 -I .git|awk '/:$/{gsub(/[^\/]+\//,\"--\",\$0);printf(\"%d files\n%s \t\",p-2,\$0);p=0}{p++}END{print p \" files\"}'|less -FXn" # Cut -FX in ash
#alias bell="printf '\a'" # either echo -ne '\007' or printf '\a'" or tput bel
alias h="history"
alias hc="history -c"
alias psql="INPUTRC=/dev/fd/9 psql 9<<<'set editing-mode vi'"
alias mysql="INPUTRC=/dev/fd/9 mysql 9<<<'set editing-mode vi'"
# This is getting even uglier, but must have on remote machines
alias tig='TIGRC_USER=/dev/fd/9 tig 9<<<"set main-options = --all${IFS}set main-view = line-number:no,interval=5 id:yes date:relative author:abbreviated commit-title:yes,graph,refs,overflow=no"'
alias gl="git log --graph --pretty=format:'%Cred%h%Creset -%C(auto)%d%Creset %s %Cgreen(%cr) %C(cyan)<%an>%Creset' --abbrev-commit --date=relative --all --date-order"
alias gs="git status -sb"

# Only if not on busybox
[ -L $(type -p grep) ] || alias grep="grep --color"
# No alt screen, no line-numbers
[ -L $(type -p less) ] || alias less="less -Xn"

# Use bash-completion, if available
[ -f /usr/share/bash-completion/bash_completion ] && . /usr/share/bash-completion/bash_completion

# Shell options.
# histverify (NOT USED NOW): Poor man's history expansion (which bash doesn't do on TAB)
# globstar: To have "**" as in zsh
# cdspell, dirspell: Spell checking on tab expansion
# checkwinsize: Set LINES and COLUMNS
# cmdhist: Save multi-line commands as one command
shopt -s globstar cdspell dirspell checkwinsize cmdhist

# Configure readline
bind 'TAB:menu-complete'
bind '"\e[Z": menu-complete-backward'
bind 'set menu-complete-display-prefix on'
bind 'set show-all-if-ambiguous on'
bind 'set show-all-if-unmodified on'
bind 'set completion-ignore-case on'
bind 'set match-hidden-files off'
bind 'set colored-stats on'
bind 'set colored-completion-prefix on'
bind 'set visible-stats on'
bind 'set completion-prefix-display-length 1'
bind 'set skip-completed-text on'
bind 'set history-preserve-point on'
bind 'set mark-symlinked-directories on'
# History expansion on space
bind 'space:magic-space'

# Better history stepping, both in insert and command mode
# HACK: Assigning functions to non-existent keys, so a few lines down we can do two things on one keypress. This is all about the jump to end-of-line
bind -m vi '"\200":previous-history'
bind -m vi '"\201":next-history'
bind -m vi '"\202":end-of-line'
bind -m vi 'k:"\200\202"'
bind -m vi 'j:"\201\202"'
# NOTE: use `tput rmkx` or `reset` when the terminal is sending \eOA instead of \e[A (stuck in "app mode")
bind -m vi '"\e[A":"\200\202"'
bind -m vi '"\e[B":"\201\202"'
bind -m vi-insert '"\e[A":history-search-backward'
bind -m vi-insert '"\e[B":history-search-forward'
# And I still want CTRL-L in insert mode
bind -m vi-insert "C-l:clear-screen"

# Restore default completion for cd, since bash-completion doesn't handle wildcards
compopt -o bashdefault cd

# START of better systemd.
# Makes it almost usable, works around brain-dead-ness, even add some comfort:
# - Unlike simple aliases, we still bash-complete.
# - We use $SC to store (automatically) the unit we're working on, so no need for typing all the time, or history athletics. One rarely works on multiple services at once.
# - Functions start, reload and restart show the status of how it went, and also tails the log/journal afterwards. Exit tail with CTRL-c.

# Generic helper functions to set up bash-autocomplete for our aliases
_scx() { COMP_WORDS=("systemctl" "$1" "${COMP_WORDS[@]:1}") ; ((COMP_CWORD++)) ; _systemctl ; }
_jcx() { COMP_WORDS=("journalctl" "$1" "${COMP_WORDS[@]:1}") ; ((COMP_CWORD++)) ; _journalctl ; }

# "SystemCtl", generic alias, because who has time to type THAT much?
sc() { SC="${@: -1}" ; systemctl "$@" ; }
complete -F _systemctl sc
# "User-level SystemCtl" alias, becuase, there's NOT even a short-option or something...
usc() { SC="${@: -1}" ; systemctl --user "$@" ; }
_usc() { _scx --user ; }
complete -F _usc usc
# "SystemCtl List" services, because it should be simple
scl() { systemctl list-units --type service --all ; }
# Systemctl Daemon-Reload", because systemd can't do it on its own... Do user or system depending on UID
sdr() { [ $UID -eq 0 ] && systemctl daemon-reload || systemctl --user daemon-reload ; }

# JournalCtl for Unit
jcu() { SC="${1:-${SC}}" ; journalctl -xe --unit "$SC" ; }
_jcu() { _jcx "--unit" ; }
complete -F _jcu jcu
# User-level JournalCtrl for Unit
ujcu() { SC="${1:-${SC}}" ; journalctl -xe --user-unit "$SC" ; }
_ujcu() { _jcx "--user-unit" ; }
complete -F _ujcu ujcu

# Reusable command to show status afterwards, and tail the log during reload. Exit with CTRL-c
# - We use daemon-reload automatically, because very often the thing you modified for a restart is the unit file.
# - We use reset-failed, because for some incomprehensible reason, the restart-count limit imposed by StartLimitInterval[Sec] also affects manual restarts.
stail() { SC="${2:-${SC}}" ; sdr ; systemctl reset-failed "$SC" ; journalctl -n 0 -xfu "$SC" & systemctl "$1" "$SC" ; scs ; fg %journalctl ; }
# Param #1: desired function name
# Param #2: command to call
# Param #3: command action to call
# Param #4+: any further options to pass to action
_mksc() {
	eval "$1() { SC=\"\${1:-\${SC}}\" ; $2 $3 ${@:4} \"\$SC\" ; }"
	eval "_$1() { _scx \"$3\" ; }"
	eval "complete -F _$1 $1"
}
# Definitions:
_mksc scs systemctl status -l # status, but don't trim lines
_mksc sc0 systemctl stop
_mksc sc1 stail start
_mksc scr stail reload-or-restart
_mksc scR stail restart
# Override sc0 to add an additional `scs` to show status afterwards
sc0() { SC="${1:-${SC}}" ; systemctl stop "$SC" ; scs ; }

# Now fix bash competion for our systemd aliases.
# Even without bash-completion, most linux package managers put these there from the systemd packages - take advantage.
[ -f /usr/share/bash-completion/completions/systemctl ] && . /usr/share/bash-completion/completions/systemctl
[ -f /usr/share/bash-completion/completions/journalctl ] && . /usr/share/bash-completion/completions/journalctl
# END of better systemd.

# END of part to be injected

# Commands which are not required in remote inject
alias json="python -mjson.tool"
alias tmux="tmux -2"

# Locally we don't need these (but leave them in the inject part)
unalias tig

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
