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

_lineinfile "line" "FIRST LINE" "$F"
_lineinfile 'second/line' "SECOND LINE" "$F"
_lineinfile "fourth" "LAST LINE" "$F"
_lineinfile "rd li" "THIRD\nLINE" "$F"
_lineinfile "^LINE" 'FOURTH LINE' "$F"
_lineinfile 'commented \?=' "commented=100 // Added by lineinfile" "$F"
_lineinfile "THIRD" "& LINE" "$F"

cat "$F"
rm "$F"
