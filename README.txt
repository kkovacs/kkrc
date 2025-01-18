
# KKovacs's dotfiles

This directory contains some configuration files that I like to use, and
recently I got tired of copying them around to all machines and user accounts I
have.

This newer version uses soft-links instead of copying files around. Works on
the user level (it was tedious and error-prone to maintain the system-level
variations between various operating systems, distributions, etc.)

To install:

git clone https://github.com/kkovacs/kkrc/ ~/.kkrc; ~/.kkrc/install.sh

After that, you can always update with:

~/.kkrc/update.sh

# Injection

Read more about the `inject-*` files here: <https://kkovacs.eu/keystroke-injection-for-comfort/>
