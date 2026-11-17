#!/usr/bin/env python3
"""kmodem test, no tmux. A pty plays the "remote" (cwd = a temp dir) and runs the line the tmux menu types:
  recv: `cat DATA | bash -c "$(...KMREADY...)" kmodem`   expect ~/kmodem.bin (here: KMODEM_OUT) == DATA
  send: `bash -c "$(...KMREADY...)" kmodem`              expect the remote's ./kmodem.bin == DATA
The relay does what `pipe-pane -IO` does: pty output -> kmodem.py stdin, kmodem.py stdout -> pty input.
Damaged cases hurt both directions on purpose (only after the helper is up):
  to the notebook: rows vanish or lose their tail (like remote-tmux redraw losses), one complete row gets a payload
    char changed (same length, valid base64: only the whole-file sha256 can catch it), some replies get lost;
  to the remote: in one W line a char changes, from another one a slice is dropped.
kmodem.py must repair all of it, and its log must show the whole-file check caught something.
Output: PASS/FAIL lines. Exit 0 only if all pass."""
import fcntl, os, pty, random, select, shutil, signal, struct, subprocess, sys, tempfile, termios, time

HERE = os.path.dirname(os.path.realpath(__file__))
REMOTE = 'bash -c "$(printf KM%s READY >&2; base64 -d </dev/tty | gunzip)" kmodem'   # as in .tmux.main
B64 = set(b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")


def flip(l, j):
    return l[:j] + (b"A" if l[j:j + 1] != b"A" else b"B") + l[j + 1:]


def to_notebook(d, rnd, st):
    """Remote -> notebook, per relayed chunk (~one screen row each)."""
    if b"KA " in d and rnd.random() < 0.15:                             # a lost reply
        return b""
    lines = d.split(b"\n")
    if rnd.random() < 0.05:
        i = rnd.randrange(len(lines))
        if lines[i].startswith(b"KM ") and lines[i][3:4].isdigit():     # a row vanishes or loses its tail
            lines[i] = b"" if rnd.random() < 0.5 else lines[i][:rnd.randrange(len(lines[i]) + 1)]
    for k, l in enumerate(lines[:-1]):                                   # complete rows only
        if l.startswith(b"KM ") and l[3:4].isdigit() and len(l) > 30 and l.endswith(b"\r"):
            st["rows"] += 1
            if st["rows"] >= 150 and not st["flipped"]:                 # once: silent corruption, so a payload
                _, off, n, _ = l.split(b" ", 3)                          # char (not the offsets around it)
                start = 3 + len(off) + 1 + len(n) + 1
                lines[k], st["flipped"] = flip(l, rnd.randrange(start, start + int(n))), True
    return b"\n".join(lines)


def to_remote(d, st):
    """Notebook -> remote: the 2nd big chunk (part of a W line) gets a char changed, the 4th loses 1000 bytes."""
    if len(d) > 1000:
        st["big"] += 1
        if st["big"] == 2:
            d = flip(d, next(j for j in range(200, len(d)) if d[j] in B64))
        elif st["big"] == 4:
            d = d[:300] + d[1300:]
    return d


def run(mode, size, damaged):
    tmp = tempfile.mkdtemp()
    remote = os.path.join(tmp, "remote")
    os.mkdir(remote)
    data, out, log = (os.path.join(tmp, n) for n in ("data.bin", "kmodem.bin", "km.log"))
    rnd, st = random.Random(1), {"rows": 0, "flipped": False, "big": 0, "go": False}
    with open(data, "wb") as f:
        f.write(rnd.randbytes(size))
    env = dict(os.environ, KMODEM_OUT=out, KMODEM_LOG=log)
    pid, master = pty.fork()
    if pid == 0:                                                         # the "remote" shell
        os.chdir(remote)
        fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 100, 0, 0))
        line = REMOTE if mode == "send" else 'cat "$1" | ' + REMOTE
        os.execvpe("bash", ["bash", "--norc", "-c", line, "x", data], env)
    args = ["send", data] if mode == "send" else ["recv"]
    km = subprocess.Popen([sys.executable, "-I", os.path.join(HERE, "kmodem.py"), *args], env=env,
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    t0 = time.time()
    while time.time() - t0 < 90 and km.poll() is None:
        r = select.select([master, km.stdout], [], [], 0.5)[0]
        if master in r:
            try:
                d = os.read(master, 65536)
            except OSError:                                              # remote exited
                break
            if damaged and st["go"]:
                d = to_notebook(d, rnd, st)
            st["go"] |= b"KMGO" in d
            if d:
                os.write(km.stdin.fileno(), d)
        if km.stdout in r:
            if not (d := os.read(km.stdout.fileno(), 65536)):
                break
            os.write(master, to_remote(d, st) if damaged and st["go"] else d)
    try:                                                                 # remote exits on Q: let kmodem.py finish
        km.wait(timeout=10)
    except subprocess.TimeoutExpired:
        pass
    res = os.path.join(remote, "kmodem.bin") if mode == "send" else out
    ok = km.poll() == 0 and os.path.exists(res) and open(res, "rb").read() == open(data, "rb").read()
    lines = open(log).read().splitlines() if os.path.exists(log) else []
    passes, retries = sum("whole-file mismatch" in l for l in lines), sum("retry" in l for l in lines)
    if damaged and not passes:                                           # the silent damage must have been caught
        ok = False
    for p in (lambda: km.kill(), lambda: os.kill(pid, signal.SIGKILL)):
        try:
            p()
        except OSError:
            pass
    os.waitpid(pid, 0)
    shutil.rmtree(tmp)
    return ok, f"{time.time() - t0:.1f}s, {retries} gap retries, {passes} repair passes"


failed = False
for mode in ("recv", "send"):
    for size, damaged in ((100, False), (500_000, False), (500_000, True)):
        ok, info = run(mode, size, damaged)
        print(f"{'PASS' if ok else 'FAIL'}: {mode} {size} bytes, {'damaged' if damaged else 'clean'} ({info})")
        failed |= not ok
sys.exit(failed)
