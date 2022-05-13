#!/bin/bash

. ../inject-func-lineinfile.txt

cat >$TMPDIR/test1.txt <<XXX
first line
second\line
third line
;commented = 50
XXX

lineinfile "line" "FIRST LINE" $TMPDIR/test1.txt
lineinfile 'second\\line' "SECOND LINE" $TMPDIR/test1.txt
lineinfile "fourth" "LAST LINE" $TMPDIR/test1.txt
lineinfile "rd li" "THIRD\nLINE" $TMPDIR/test1.txt
lineinfile "^LINE" 'FOURTH LINE' $TMPDIR/test1.txt
lineinfile 'commented \?=' "commented=100 // Added by lineinfile" $TMPDIR/test1.txt
lineinfile "THIRD" "& LINE" $TMPDIR/test1.txt

cat $TMPDIR/test1.txt
