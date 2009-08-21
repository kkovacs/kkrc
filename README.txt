This directory contains some configuration files that I like to use, and
recently I got tired of copying them around to all machines and user accounts I
have. So I created an auto-installer for my own purposes.

Now I only need to use bash or zsh to run:

sh <(curl http://github.com/kkovacs/kkrc.git/kkrc)

and a shell script gets downloaded and executed, that will discover the
system's operating system (OS X, Freebsd or Linux (NOTE: nowadays I use only
Ubuntu so it handles every Linux like an Ubuntu server)), checks a few
necessities (curl, awk) and determines the "right" locations for the system rc
files using various hand-crafted techniques.

If the script can write into these files, then it will attach the scripts found
here to the files. If the markers "KKRC START" and "KKRC END" can be found in
the files, then the markers and the  lines between them will be removed first.
This enables automatically "updating" older scripts to newer versions.

If the script can not write to the system locations, then the files in the
user's home directory will be altered (.screenrc, .zshrc, .vimrc) the same way.
This allows me to use this same script to set up my environment (and keep it
updated) on servers where I have a normal (non-root) user account.
