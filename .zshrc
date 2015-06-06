# Set up colors
if [ ! -n "$SSH_CLIENT" ] && [ ! -n "$SSH_TTY" ]; then
	BASE16_SHELL="$HOME/.kkrc/base16-colors.dark.sh"
	[[ -s $BASE16_SHELL ]] && source $BASE16_SHELL
fi

# Set up the right-side prompt to display the current working directory
export RPROMPT='%~'
# Set up the left-side prompt to display "username@machine [background job count]# "
export PROMPT='%n@%m [%j]%# '
# Set up some necessary environment variables
export EDITOR=vim
export LC_CTYPE="en_US.UTF-8"

# The following lines were added by compinstall

zstyle ':completion:*' auto-description 'Specify: %d'
zstyle ':completion:*' completer _expand _complete _ignored _correct _approximate
zstyle ':completion:*' file-sort modification
zstyle ':completion:*' format 'Completing: %d'
zstyle ':completion:*' group-name ''
zstyle ':completion:*' list-colors ''
zstyle ':completion:*' list-prompt '%SAt %p: Hit TAB for more, or the character to insert%s'
zstyle ':completion:*' matcher-list '' 'm:{[:lower:]}={[:upper:]} m:{[:lower:][:upper:]}={[:upper:][:lower:]}' 'r:|[._-]=* r:|=*' 'l:|=* r:|=*'
zstyle ':completion:*' prompt 'Errors: %e'
zstyle ':completion:*' select-prompt '%SScrolling active: current selection at %p%s'

autoload -Uz compinit
compinit
# End of lines added by compinstall

# Bash completion emulation
autoload -Uz bashcompinit
bashcompinit

# Zsh options
setopt autocd auto_pushd pushd_ignore_dups no_nomatch hup notify hist_ignore_dups

# I must have VI keys
bindkey -v

# Fix Debian's idiotic idea that "up" key in history should jump to beginning of line (while "k" to the EOL, just to be more confusing)
[[ -z "$terminfo[kcuu1]" ]] || bindkey -M viins "$terminfo[kcuu1]" up-line-or-history
[[ -z "$terminfo[kcud1]" ]] || bindkey -M viins "$terminfo[kcud1]" down-line-or-history
[[ "$terminfo[kcuu1]" == ""* ]] && bindkey -M viins "${terminfo[kcuu1]/O/[}" up-line-or-history
[[ "$terminfo[kcud1]" == ""* ]] && bindkey -M viins "${terminfo[kcud1]/O/[}" down-line-or-history

# Set up some handy aliases
alias s="screen -xR"
alias l="ls -lrt"
alias la="ls -lrtA"

# Colored ls on OS X
export CLICOLOR=1
export LSCOLORS=ExFxCxDxBxegedabagacad

# OS-dependent stuff
case "$OSTYPE" in
	"linux-gnu")
		# Colored ls
		alias ls="ls --color"
		alias ll="lsattr"
		;;
	"darwin12.0")
		alias ll="l -@eO"
		;;
esac

# Display screens if any
screen -ls | grep -v "Socket"

# Autostart kropbox?
# ~/.kkrc/kropbox.sh

# Local commands
if [ -e ~/.zshrc.local ]; then . ~/.zshrc.local; fi
