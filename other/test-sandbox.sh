#!/bin/sh
# Sandbox verification suite.
# Tests the contract that ALL 4 sandbox types (bwrap-24, bwrap-26, docker, apple)
# must satisfy once you're in the "user" phase.
#
# Detection:
#   uid != 0       → bwrap   (already uid 1000)
#   uid == 0 + /.dockerenv → docker  (su to uid 1000 for phase 2)
#   uid == 0 + no /.dockerenv → apple  (stay root, system dirs must be writable)
#
# Output: PASS/FAIL lines. Exit 0 only if all pass.

F=0
fail(){ echo "FAIL: $1"; F=1; }
pass(){ echo "PASS: $1"; }

# try_write DIR — create, write, read back, remove a file in DIR.
try_write(){
    d="$1" t="$1/.sandbox-writetest-$$"
    touch "$t" 2>/dev/null || return 1
    printf 'ok' > "$t" 2>/dev/null || { rm -f "$t"; return 1; }
    [ "$(cat "$t" 2>/dev/null)" = "ok" ] || { rm -f "$t"; return 1; }
    rm -f "$t" 2>/dev/null; return 0
}

echo "=== Phase 0: Detection ==="
STARTED_AS_ROOT=0
IS_APPLE=0
if [ "$(id -u)" -eq 0 ]; then
    STARTED_AS_ROOT=1
    if [ -e /.dockerenv ]; then
        SANDBOX="docker"
    else
        SANDBOX="apple"
        IS_APPLE=1
    fi
else
    SANDBOX="bwrap"
fi
echo "Detected: $SANDBOX (started as $(id -un))"

# =====================================================================
# Phase 1 — root phase (docker/apple only)
# Verify we CAN install tools and reach the network before dropping privs.
# =====================================================================
if [ "$STARTED_AS_ROOT" -eq 1 ]; then
    echo ""
    echo "=== Phase 1: Root checks ($SANDBOX) ==="

    # Can install packages (the whole reason we're root in docker/apple)
    # Must come BEFORE network check so curl is available.
    if command -v apt-get >/dev/null 2>&1 && \
       apt-get update -qq >/dev/null 2>&1 && \
       apt-get install -y -qq curl >/dev/null 2>&1; then
        pass "[root] can install packages (apt-get)"
    else
        fail "[root] can install packages (apt-get)"
    fi

    # Network (curl available after package install)
    if command -v curl >/dev/null 2>&1 && \
       curl -fsS -o /dev/null --max-time 10 https://example.com 2>/dev/null; then
        pass "[root] outbound network reachable"
    else
        fail "[root] outbound network reachable"
    fi

    # Host SSH keys hidden even as root
    if [ -z "$(ls -A /root/.ssh 2>/dev/null)" ]; then
        pass "[root] /root/.ssh hidden"
    else
        fail "[root] /root/.ssh hidden"
    fi
    ssh_bad=0
    for s in /home/*/.ssh; do
        [ -e "$s" ] || continue
        [ -z "$(ls -A "$s" 2>/dev/null)" ] || ssh_bad=1
    done
    if [ "$ssh_bad" -eq 0 ]; then
        pass "[root] /home/*/.ssh hidden"
    else
        fail "[root] /home/*/.ssh hidden"
    fi
fi

# =====================================================================
# Drop privileges for docker (su to uid 1000, preserving $HOME=/tmp).
# Apple stays root; bwrap is already uid 1000.
# =====================================================================
if [ "$STARTED_AS_ROOT" -eq 1 ] && [ "$IS_APPLE" -eq 0 ]; then
    U1000=$(id -nu 1000 2>/dev/null) || U1000=""
    if [ -z "$U1000" ]; then
        echo "FATAL: uid 1000 does not exist inside container"; exit 1
    fi
    echo ""
    echo "=== Dropping to uid 1000 ($U1000) for Phase 2 ==="
    exec su - "$U1000" -c "HOME=/tmp exec \"$0\" --phase2"
    # (the exec replaces this process; --phase2 is ignored, script re-detects as bwrap-like uid≠0)
fi

# =====================================================================
# Phase 2 — user context (always runs)
# =====================================================================
echo ""
echo "=== Phase 2: User checks ($(id -un)) ==="
U=$(id -un)

# $HOME must be /tmp
if [ "$HOME" = "/tmp" ]; then
    pass "[$U] HOME is /tmp"
else
    fail "[$U] HOME is /tmp (got: $HOME)"
fi

# /tmp writable
if try_write /tmp; then
    pass "[$U] /tmp writable"
else
    fail "[$U] /tmp writable"
fi

# $PWD writable + subdir
if try_write "$PWD"; then
    pass "[$U] \$PWD ($PWD) writable"
else
    fail "[$U] \$PWD ($PWD) writable"
fi
sub="$PWD/.sandbox-sub"
if mkdir -p "$sub" 2>/dev/null && try_write "$sub"; then
    pass "[$U] subdir inside \$PWD writable"
else
    fail "[$U] subdir inside \$PWD writable"
fi
rm -rf "$sub" 2>/dev/null

# $HOME subdir writable
sub="$HOME/.sandbox-sub"
if mkdir -p "$sub" 2>/dev/null && try_write "$sub"; then
    pass "[$U] subdir inside \$HOME writable"
else
    fail "[$U] subdir inside \$HOME writable"
fi
rm -rf "$sub" 2>/dev/null

# Network
if command -v curl >/dev/null 2>&1 && \
   curl -fsS -o /dev/null --max-time 10 https://example.com 2>/dev/null; then
    pass "[$U] outbound network reachable"
else
    fail "[$U] outbound network reachable"
fi

# Host SSH keys hidden
if [ -z "$(ls -A /root/.ssh 2>/dev/null)" ]; then
    pass "[$U] /root/.ssh hidden"
else
    fail "[$U] /root/.ssh hidden"
fi
ssh_bad=0
for s in /home/*/.ssh; do
    [ -e "$s" ] || continue
    [ -z "$(ls -A "$s" 2>/dev/null)" ] || ssh_bad=1
done
if [ "$ssh_bad" -eq 0 ]; then
    pass "[$U] /home/*/.ssh hidden"
else
    fail "[$U] /home/*/.ssh hidden"
fi

# System dirs: read-only for uid≠0, writable for uid==0 (apple root)
for d in /usr /bin /sbin /lib /lib64 /etc; do
    [ -d "$d" ] || continue
    if [ "$(id -u)" -eq 0 ]; then
        # Apple stays root — these dirs must be writable (they're the container's)
        if try_write "$d"; then
            pass "[$U] $d writable (apple root)"
        else
            fail "[$U] $d writable (apple root)"
        fi
    else
        # bwrap / docker uid 1000 — must be read-only
        if try_write "$d"; then
            fail "[$U] $d read-only — expected NOT writable"
        else
            pass "[$U] $d read-only"
        fi
    fi
done

echo ""
[ "$F" -eq 0 ] && echo "All checks passed." || echo "Some checks FAILED."
exit "$F"
