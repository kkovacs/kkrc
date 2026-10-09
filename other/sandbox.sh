#!/bin/bash
#
# Minimalist sandbox solution using only default Linux tools, no root needed on Ubuntu 26.04.
#
# sandbox [cmd...] - run cmd (default: bash -i) as the current uid in a fresh root:
# only $PWD is real/writable; /usr /etc /var /opt are read-only; fresh /tmp; nothing else of the host.
H=$(pwd -P) R=$(readlink -f /etc/resolv.conf) U=$(id -u) G=$(id -g)
[ $# -eq 0 ] && set -- bash -i
exec unshare --map-root-user --mount --pid --fork --kill-child --uts --ipc --propagation private env H="$H" R="$R" U="$U" G="$G" bash -c '
set -eu
mount -t tmpfs t /mnt                        # scratch space (/run, /tmp may be unwritable)
N=/mnt/new; mkdir $N; mount -t tmpfs t $N    # pivot_root needs a mount point
for d in usr etc var opt; do                 # system dirs: read-only binds
  [ -d /$d ] || continue
  mkdir $N/$d; mount --rbind /$d $N/$d; mount -o remount,bind,ro $N/$d
done
for l in bin sbin lib lib64; do ln -s usr/$l $N/$l; done
mkdir -p "$N$H" $N/tmp $N/dev $N/proc $N/run
mount --rbind "$H" "$N$H"                    # the only real host dir
mount -t tmpfs t $N/tmp; chmod 1777 $N/tmp
mount -t tmpfs -o mode=0755 t $N/dev         # minimal /dev: individual nodes + private devpts
for n in null zero full random urandom tty; do touch $N/dev/$n; mount --bind /dev/$n $N/dev/$n; done
mkdir $N/dev/pts $N/dev/shm; mount -t devpts -o newinstance,ptmxmode=0666 devpts $N/dev/pts
mount -t tmpfs t $N/dev/shm; ln -s pts/ptmx $N/dev/ptmx; ln -s /proc/self/fd $N/dev/fd
# resolv.conf is a symlink into /run (systemd-resolved), which the /etc bind leaves dangling: bind its target
# XXX breaks if resolv.conf is a plain file under /etc (read-only by now); not worth guarding today
mkdir -p "$N$(dirname "$R")"; touch "$N$R"; mount --bind "$R" "$N$R"
mount -t proc p $N/proc
mkdir $N/.old; cd $N
pivot_root . .old; umount -l /.old           # lazy on purpose: recursive umount fails on locked mounts
cd "$H"
# nested userns: become the original uid. It owns no mount namespace, so it has no caps over the
# mounts above and cannot undo them. XXX never add --map-root-user here: that would re-grant caps.
HOME=/tmp exec unshare --map-user=$U --map-group=$G "$@"' bash "$@"
