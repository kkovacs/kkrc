# Set up colors
if [ ! -n "$SSH_CLIENT" ] && [ ! -n "$SSH_TTY" ]; then
	BASE16_SHELL="$HOME/.kkrc/base16-colors.dark.sh"
	[[ -s $BASE16_SHELL ]] && source $BASE16_SHELL
fi

# OS-dependent stuff
case "$OSTYPE" in
	linux-gnu)
		# Colored ls
		alias ls="ls --color"
		# ls with extended attributes
		alias lx="lsattr"
		;;
	FreeBSD)
		;&
	darwin*)
		# ls with extended attributes
		alias lx="l -@eO"
		# Colored ls on OS X
		export CLICOLOR=1
		;;
esac

# BSD colors
export LSCOLORS=ExFxCxDxBxegedabagacad
# Linux colors -- set always because of zsh's list-colors
export LS_COLORS="di=1;34:ln=1;35:so=1;32:pi=1;33:ex=1;31:bd=34;46:cd=34;43:su=30;41:sg=30;46:tw=30;42:ow=30;43"

# Needed for a colored prompt
autoload -Uz colors && colors
# Function to toggle zsh's RPROMPT.
function rp () {
	if [[ "$RPROMPT" == "" || "$1" == "on" ]]; then
		# Set up the right-side prompt to display the current working directory
		export RPROMPT="%{$fg_bold[yellow]%}%~%{$reset_color%}"
		# B&W: export RPROMPT='%~'
		# Set up the left-side prompt to display "username@machine [background job count]# ", and if root, username be red
		export PROMPT="%{%(#~$fg[red]~$fg[blue])%}%n%{$reset_color%}@%{$fg[green]%}%m %{$fg_no_bold[cyan]%}[%j]%{$reset_color%}%# "
		# B&W: export PROMPT='%n@%m [%j]%# '
	else
		# No RPROMPT, set up the left-side prompt to contain the directory
		export RPROMPT=''
		export PROMPT="%{%(#~$fg[red]~$fg[blue])%}%n%{$reset_color%}@%{$fg[green]%}%m %{$fg_bold[yellow]%}%~%{$reset_color%} %{$fg_no_bold[cyan]%}[%j]%{$reset_color%}%# "
		# B&W: export PROMPT='%n@%m %~ [%j]%# '
	fi
}
# Initialize (to off)
rp on; rp

# Set up some necessary environment variables
export EDITOR=vim
export LC_CTYPE="en_US.UTF-8"

# Keep some history...
export HISTSIZE=1000
# ...but only in memory...
export SAVEHIST=0
export HISTFILE=/dev/null
# ... and actually display that history when asked. (With ISO timestamp and duration!)
alias history="fc -liD 0"
# And `h` as a super-short alias to `history`
alias h=history

# Autocomplete
autoload -Uz compinit && compinit
zmodload -i zsh/complist        
bindkey -M menuselect '^[[Z' reverse-menu-complete # Shift-tab in complist
zstyle ':completion:*' auto-description 'Specify: %d'
zstyle ':completion:*' completer _expand _complete _ignored _correct _approximate
zstyle ':completion:*' file-sort modification
zstyle ':completion:*' format 'Completing: %d'
zstyle ':completion:*' group-name ''
zstyle ':completion:*' list-prompt '%SAt %p: Hit TAB for more, or the character to insert%s'
zstyle ':completion:*' matcher-list '' 'm:{[:lower:]}={[:upper:]} m:{[:lower:][:upper:]}={[:upper:][:lower:]}' 'r:|[._-]=* r:|=*' 'l:|=* r:|=*'
zstyle ':completion:*' prompt 'Errors: %e'
zstyle ':completion:*' select-prompt '%SScrolling active: current selection at %p%s'
zstyle ':completion:*' list-colors ${(s.:.)LS_COLORS}
zstyle ':completion:*' menu select=2
zstyle ':completion:*' verbose yes

# Bash completion emulation
autoload -Uz bashcompinit && bashcompinit

# Zsh options
setopt auto_pushd pushd_ignore_dups no_nomatch hup notify hist_ignore_dups hash_list_all completealiases always_to_end complete_in_word correct list_ambiguous

# I must have VI keys
bindkey -v

# But still, CTRL-R as history search in bash nice
bindkey '^R' history-incremental-search-backward

# Fix Debian's idiotic idea that "up" key in history should jump to beginning of line (while "k" to the EOL, just to be more confusing)
[[ -z "$terminfo[kcuu1]" ]] || bindkey -M viins "$terminfo[kcuu1]" up-line-or-history
[[ -z "$terminfo[kcud1]" ]] || bindkey -M viins "$terminfo[kcud1]" down-line-or-history
[[ "$terminfo[kcuu1]" == ""* ]] && bindkey -M viins "${terminfo[kcuu1]/O/[}" up-line-or-history
[[ "$terminfo[kcud1]" == ""* ]] && bindkey -M viins "${terminfo[kcud1]/O/[}" down-line-or-history

# CTRL-K and CTRL-J as history-search with the already typed part of the line.
# Both in command and insert mode.
bindkey -M viins '^k' up-line-or-search
bindkey -M viins '^j' down-line-or-search
bindkey -M vicmd '^k' up-line-or-search
bindkey -M vicmd '^j' down-line-or-search
# Same for cursor keys ctrl-up and ctrl-down, both command and insert mode.
bindkey -M viins '^[[1;5A' up-line-or-search
bindkey -M viins '^[[1;5B' down-line-or-search
bindkey -M vicmd '^[[1;5A' up-line-or-search
bindkey -M vicmd '^[[1;5B' down-line-or-search

# Set up some handy aliases
alias s="screen -xR"
alias l="ls -lrt"
alias la="ls -lrtA"
alias ll="ls -lhFrt"
alias grep="grep --color"
alias json="python -mjson.tool"
alias kargs="xargs -n 1 -P `getconf _NPROCESSORS_ONLN` -I{}"
alias tmux="tmux -2"

# hl - highlight command
source ~/.kkrc/hl

# Automatically set TMUX window title on SSH
ssh() {
    tmux rename-window "$*" >/dev/null 2>/dev/null
    command ssh "$@"
    # To switch back to auto-renaming after disconnection:
    #tmux set-window-option automatic-rename "on" >/dev/null 2>/dev/null
}

# Display screens if any
screen -ls | grep -v "Socket"

# Autostart kropbox?
# ~/.kkrc/other/kropbox.sh

# Local commands
if [ -e ~/.zshrc.local ]; then . ~/.zshrc.local; fi
