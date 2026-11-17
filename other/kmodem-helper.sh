#!/bin/bash
# kmodem helper (REMOTE side): a stateless server for ONE file on the tty, for both directions.
# Normally not run by hand: kmodem.py types it in (gzip+base64) after the tmux menu entry typed
#   recv: `<your command> | bash -c "$(... base64 -d </dev/tty | gunzip)" kmodem`  -> serves the command's output
#   send: `bash -c "$(... base64 -d </dev/tty | gunzip)" kmodem`                   -> fills ./kmodem.bin (overwrites)
# Verbs, one per line, all idempotent (whatever gets lost is simply asked for again by the notebook):
#   W <off> <base64>   write the decoded bytes at byte <off>
#   R <off> <len>      print <len> bytes at <off> as rows "KM <offset> <chars> <base64> <offset>." then "KM E <off> <len>."
#   C <off> <len>      print the sha256 (first 32 hex) of <len> bytes at <off>
#   P <n>              print "pong n" (pacing)
#   Q                  quit
# Needs only bash + GNU coreutils (dd with *_bytes flags, base64, sha256sum, awk, stty, mktemp).
old=$(stty -g </dev/tty)
stty -echo -icanon min 1 time 0 </dev/tty   # no echo; non-canonical: W lines may exceed 4095 chars
if [ -t 0 ]; then                           # stdin is the tty: send (notebook -> here)
  f=kmodem.bin; : > "$f"
  trap 'stty "$old" </dev/tty' EXIT         # isig stays on: Ctrl-C aborts and the trap restores the tty
else                                        # stdin is a pipe: recv (here -> notebook)
  f=$(mktemp) || exit 1
  trap 'stty "$old" </dev/tty; rm -f "$f"' EXIT
  cat > "$f"
fi
# Base64 chars per R row: ONE screen row (width minus ~32 chars of "KM <offset> <chars> " ... " <offset>."), multiple
# of 4 so every row decodes on its own. A row wrapped over several screen rows gets shredded by remote-tmux redraws
# into valid-looking garbage; a partially redrawn single row is just short and gets rejected. The offset is repeated
# at the end: a header cut short and glued to its own continuation can form another valid offset ("KM 12"+"26 76 .."
# from "KM 120726 76 ..") - the trailing copy can't be fixed up the same way, so such a splice gets rejected.
cols=$(stty size </dev/tty | cut -d' ' -f2)
fw=$(( cols > 52 ? (cols - 32 > 1000 ? 1000 : cols - 32) / 4 * 4 : 20 ))
printf 'KMGO %s %s.\n' "$(wc -c < "$f")" "$fw" >&2
while read -r v a b; do
  case $v in
    W) base64 -d <<<"$b" | dd of="$f" bs=1M seek="$a" oflag=seek_bytes conv=notrunc 2>/dev/null ;;
    R) { dd if="$f" bs=1M skip="$a" count="$b" iflag=skip_bytes,count_bytes 2>/dev/null | base64 -w "$fw" |
           awk -v o="$a" -v s=$((fw / 4 * 3)) '{x = o + (NR - 1) * s; print "KM", x, length($0), $0, x "."}'
         printf 'KM E %s %s.\n' "$a" "$b"; } >&2 ;;
    C) printf 'KA c %s %s %s.\n' "$a" "$b" "$(dd if="$f" bs=1M skip="$a" count="$b" iflag=skip_bytes,count_bytes 2>/dev/null | sha256sum | cut -c1-32)" >&2 ;;
    P) printf 'KA p %s.\n' "$a" >&2 ;;
    Q) break ;;
  esac
done </dev/tty
