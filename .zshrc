
# Set up the right-side prompt to display the current working directory
export RPROMPT='%~'
# Set up the left-side prompt to display "username@machine [background job count]# "
export PROMPT='%n@%m [%j]%# '
# Set up some necessary environment variables
export EDITOR=vim
export LC_CTYPE="en_US.UTF-8"

# Set up tab completion
zstyle ':completion:*' completer _expand _complete _match _correct _approximate _prefix
zstyle ':completion:*' list-colors ''
zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z} r:|[._-]=* r:|=*' 'm:{a-zA-Z}={A-Za-z} r:|[._-]=* r:|=*'
autoload -Uz compinit bashcompinit
compinit
bashcompinit

# Zsh options
setopt autocd auto_pushd pushd_ignore_dups no_nomatch hup

# I must have VI keys
bindkey -v

# Set up some handy aliases
alias s="screen -xR"

# Autostart kropbox?
# ~/.kkrc/kropbox.sh

# Local commands:
