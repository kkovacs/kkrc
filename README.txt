This directory contains some configuration files that I like to use, and
recently I got tired of copying them around to all machines and user accounts I
have. So I created an auto-installer for my own purposes.

Now I only need to use bash or zsh to run:

sh <(curl https://github.com/kkovacs/kkrc/raw/master/kkrc)

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

------------------------------------------------------------------------------
Your output should look like this (example):
------------------------------------------------------------------------------

Mac-mini-G4# sh <(curl "https://github.com/kkovacs/kkrc/raw/master/kkrc")
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100  3562  100  3562    0     0   2183      0  0:00:01  0:00:01 --:--:--  8994

==============================================
Welcome to KKovacs's rc file installer script!
==============================================

VIM said your vimrc path is '/usr/share/vim/'.
Zshrc path is '/etc/'.
Your system looks like an OS X to me.
Dissecting strings from /usr/bin/screen...
Your screenrc path is '/private/etc/'.
You have CURL, it's ok.
You have AWK, it's ok.
Sounds reasonable to you? Shall we start? Hit ENTER if yes.

======== screenrc ========
Your /private/etc/screenrc... 
...does not exist. We will see if you have the rights to create one... 
...and yes you have!
Looking for my past work in /private/etc/screenrc...
I think I haven't been here before.

Looks like we will work on /private/etc/screenrc .
Making a backup to /private/etc/screenrc.backup-before-kkrc...
Cutting my previous work...
Downloading and appending snippet...
... and we are done.
======== zshrc ========
Your /etc/zshrc... 
...does not exist. We will see if you have the rights to create one... 
...and yes you have!
Looking for my past work in /etc/zshrc...
I think I haven't been here before.

Looks like we will work on /etc/zshrc .
Making a backup to /etc/zshrc.backup-before-kkrc...
Cutting my previous work...
Downloading and appending snippet...
... and we are done.
======== vimrc ========
Your /usr/share/vim/vimrc... 
...exists... 
...and is WRITABLE!
Looking for my past work in /usr/share/vim/vimrc...
I think I haven't been here before.

Looks like we will work on /usr/share/vim/vimrc .
Making a backup to /usr/share/vim/vimrc.backup-before-kkrc...
Cutting my previous work...
Downloading and appending snippet...
... and we are done.
Mac-mini-G4# _
------------------------------------------------------------------------------
