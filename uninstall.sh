#!/bin/bash

# Change to own dir
curdir="$(pwd)"
kkrcdir="$(dirname "$0")"
cd "$kkrcdir" || exit 1

# Installs the softlinks in place.
process() {
        local file="$1"
        local softlink="$2"

        echo "Removing softlink $file..."

        if [ -L "$softlink" ]; then
                echo "OK: Softlink. Removing."
                rm "$softlink"
        else
                echo "WARNING: $softlink is not a softlink"
        fi

        # Just for pretty formatting
        echo
}

# Process all files/dirs
. ./kkrc-files

# .bashrc.orig is a special case, since that's where we moved the original.
# Now rename it back
if [ -f ~/.bashrc.orig ]; then
        printf "OK: Renaming .bashrc.orig to .bashrc\n"
        mv ~/.bashrc.orig ~/.bashrc
else
        printf "INFO: No .bashrc.orig found\n"
fi

# Last step
echo "Ready to run 'rm -rf $kkrcdir'? (y/n)"
read -r A
if [ "$A" = "y" ]; then
        cd "$curdir"
        rm -rf "$kkrcdir"
fi
