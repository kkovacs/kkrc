#!/bin/bash

#
# Kropbox is "KKovacs's Dropbox", an extremely simple git-based
#

KROPBOXDIR=~
SLEEPTIME=60

# Sanity check: do we have git and screen installed?
type -p screen >/dev/null
if [ $? -ne 0 ]; then
	echo "Can't find GNU SCREEN - do you have it installed?"
	exit 1;
fi
type -p git >/dev/null
if [ $? -ne 0 ]; then
	echo "Can't find GIT - do you have it installed?"
	exit 1;
fi

# If the script was called without arguments, it looks for directories
if [ $# -eq 0 ]; then 
	# Work in the given directory
	cd $KROPBOXDIR
	#echo "Checking if '.kropbox' sync screens are running..."
	for a in `ls */.kropbox`; do # XXX Todo: error if none found
		SUBDIR=`dirname $a`
		IS_RUNNING=`screen -ls | grep "[0-9]\\.kb-$SUBDIR" | wc -l`
		if [ $IS_RUNNING -gt 0 ]; then
			echo "[kb-$SUBDIR] running, OK."
		else
			echo "[kb-$SUBDIR] not running, starting it. (You can attach it with '$0 attach $SUBDIR')"
			screen -dmS kb-$SUBDIR ~/.kkrc/kropbox.sh sync $SUBDIR
		fi
	done
fi

# "sync" command means it's supposed to do the sync
if [ $# -eq 2 -a x$1 = "xsync" ]; then 
	SUBDIR=$2
	# Sanity check
	if [ ! -d $SUBDIR ]; then
		echo "$SUBDIR is not a directory!"
		exit 1;
	fi

	cd $SUBDIR

	# Keep syncing
	while true; do
		echo "Doing 'sync' for $SUBDIR..."
		date
		git pull
		git add -A
		git commit -m "$(uname -n)"
		git push
		sleep $SLEEPTIME
	done
fi

# "kill" command means kill
if [ $# -eq 2 -a x$1 = "xkill" ]; then 
	SUBDIR=$2
	screen -S kb-$SUBDIR -p 0 -X kill
fi

# "attach" command means attach
if [ $# -eq 2 -a x$1 = "xattach" ]; then 
	SUBDIR=$2
	screen -x kb-$SUBDIR
fi
