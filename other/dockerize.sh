#!/bin/bash
#
# A somewhat hackish way that prevents littering machines with certain bloated
# tools, if you have docker installed (a fairly bloated tool :) )

# An associative array that finds TOOL's full name and command line from TOOL.
declare -A TOOLMAP=(
    # PHP
    ["php"]="php:alpine"
    ["frankenphp"]="dunglas/frankenphp:alpine"
    ["composer"]="composer"
    # Nodejs
    ["node"]="node:alpine"
    ["npm"]="node:alpine npm"
    ["npx"]="node:alpine npx"
    ["yarn"]="node:alpine yarn"
    # Java
    ["jar"]="openjdk jar"
    ["java"]="openjdk java"
    ["javac"]="openjdk javac"
    # Python
    ["pip"]="python:alpine pip"
    ["python"]="python:alpine python"
    # Other tools
    ["pandoc"]="pandoc/latex"
)

# Did we get called via softlink?
TOOL="${0##*/}"

case "$TOOL" in
    # Running as self
    dockerize.sh)
        for key in "${!TOOLMAP[@]}"; do
            FILE="/usr/local/bin/$key"
            case "$1" in
                install | --install | -i)
                    if [[ -e "$FILE" ]]; then
                        echo "$FILE already exists, skipping!"
                    else
                        echo "Installing $FILE..."
                        sudo ln -s "dockerize.sh" "/usr/local/bin/$key"
                    fi
                    ;;
                uninstall | --uninstall | -u)
                    if [[ ! -e "$FILE" ]]; then
                        echo "$FILE doesn't exist, skipping!"
                    elif [[ ! -L "$FILE" ]]; then
                        echo "$FILE is NOT A LINK, not removing!"
                    else
                        echo "Removing softlink $FILE..."
                        sudo rm "/usr/local/bin/$key"
                    fi
                ;;
            esac
        done
        exit
    ;;
    # Running as a soft link
    *)
        # sudo needed to run docker?
        if [[ ! -r /var/run/docker.sock ]]; then
            SUDO=sudo
        fi

        # Look up tool full name and params
        TOOLFULL="${TOOLMAP[$TOOL]:-$TOOL}"

        # NOTE: Intentionally no "" around TOOLFULL! Need to expand
        exec $SUDO docker run -it --rm -v "$PWD":/app -w /app --network=host -u "$(id -u):$(id -g)" $TOOLFULL "$@"
    ;;
esac

# vim: sw=4 ts=4 et :
