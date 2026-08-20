#!/bin/sh
# Compact sandbox checks. Exit 0 only if all pass.

F=0
fail(){ echo "FAIL: $1"; F=1; }
U1000=$(id -nu 1000)
HOME_PATH=$HOME
PWD_PATH=$PWD

# Required system dirs must exist, be readable, and not be writable.
for d in /usr /bin /sbin /lib /lib64 /etc; do
  test -d "$d" && test -r "$d" && ! test -w "$d" && echo "PASS: $d ro" || fail "$d ro"
done

# Network: try curl, fall back to bash /dev/tcp (plain HTTP).
{ command -v curl >/dev/null 2>&1 && curl -fsS -o /dev/null --max-time 10 https://example.com 2>/dev/null; } || bash -c 'exec 3<>/dev/tcp/example.com/80 && printf "GET / HTTP/1.0\r\nHost: example.com\r\n\r\n" >&3 && IFS= read -r l <&3 && case "${l#* }" in 2*|3*) exit 0;; *) exit 1;; esac' 2>/dev/null && echo "PASS: network" || fail "network"

# Root and home .ssh dirs must be empty or nonexistent.
test -z "$(ls -A /root/.ssh 2>/dev/null)" && echo "PASS: /root/.ssh hidden" || fail "/root/.ssh hidden"
bad=0
for s in /home/*/.ssh; do
    [ -e "$s" ] || continue
    [ -z "$(ls -A "$s" 2>/dev/null)" ] || bad=1
done
test "$bad" -eq 0 && echo "PASS: /home/*/.ssh hidden" || fail "/home/*/.ssh hidden"

# uid-1000 checks: home, cwd, /tmp writable.
if [ "$(id -u)" -eq 0 ]; then
    su - "$U1000" -c "f=0
        test -r '$HOME_PATH' && test -w '$HOME_PATH' && echo 'PASS: home r/w' || { echo 'FAIL: home r/w'; f=1; }
        test -r '$PWD_PATH' && test -w '$PWD_PATH' && echo 'PASS: cwd r/w' || { echo 'FAIL: cwd r/w'; f=1; }
        test -r /tmp && test -w /tmp && echo 'PASS: /tmp r/w' || { echo 'FAIL: /tmp r/w'; f=1; }
        exit \"\$f\""
    [ $? -eq 0 ] || F=1
else
    test -r "$HOME_PATH" && test -w "$HOME_PATH" && echo "PASS: home r/w" || fail "home r/w"
    test -r "$PWD_PATH" && test -w "$PWD_PATH" && echo "PASS: cwd r/w" || fail "cwd r/w"
    test -r /tmp && test -w /tmp && echo "PASS: /tmp r/w" || fail "/tmp r/w"
fi

test "$F" -eq 0 && echo "All checks passed." || echo "Some checks failed."
exit "$F"
