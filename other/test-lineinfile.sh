#!/bin/bash

cd $(dirname $0)
F=$(mktemp)

. ../inject-func-lineinfile.txt

cat >"$F" <<XXX
first line
second/line
third line
;commented = 50
XXX

lineinfile "line" "FIRST LINE" "$F"
lineinfile 'second/line' "SECOND LINE" "$F"
lineinfile "fourth" "LAST LINE" "$F"
lineinfile "rd li" "THIRD\nLINE" "$F"
lineinfile "^LINE" 'FOURTH LINE' "$F"
lineinfile 'commented \?=' "commented=100 // Added by lineinfile" "$F"
lineinfile "THIRD" "& LINE" "$F"

cat "$F"
rm "$F"
