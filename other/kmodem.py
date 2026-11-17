#!/usr/bin/env python3
"""kmodem (NOTEBOOK side): move a file through a tmux pane over ssh (+ remote tmux), ZMODEM-style.
  kmodem.py recv          the remote command's output (`<cmd> | bash -c ...`) -> ~/kmodem.bin
  kmodem.py send PATH     a local file -> the remote's ./kmodem.bin (PATH: raw prompt text, quoting/escapes ok)
Started by the "kmodem receive/send" entries in .tmux.main via `tmux pipe-pane -IO`: stdin = pane output (noisy:
escapes, remote tmux redraws), stdout = typed into the pane. On KMREADY we type in kmodem-helper.sh, a stateless
one-file server (see there). We drive everything: whatever gets lost is simply asked for again, and the sha256 of
the whole file decides. Never extracts or interprets the data."""
import base64, gzip, hashlib, os, re, select, shlex, sys, time

HERE = os.path.dirname(os.path.realpath(__file__))
OUT = os.environ.get("KMODEM_OUT", os.path.expanduser("~/kmodem.bin"))   # recv target (the test overrides it)
LOG = os.environ.get("KMODEM_LOG")                                         # optional debug log (the test reads it)
BLK = 196608     # bytes per W line / R request / repair unit (measured: 48K..512K all ~1.1 MB/s)
WIN = 4          # send: ping every WIN blocks, to stay in step with what the remote has actually written
TMO = 3          # seconds to wait for a reply (or for more rows); lost ones are simply asked for again
IDLE = 900       # recv: the helper buffers the whole command output first, so it may be quiet a long while

# Escape sequences (remote tmux redraws etc.), then leftover control chars incl. CR/LF.
ESC = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)'
                 r'|\x1b[P_^X][^\x1b]*\x1b\\|\x1b[()][0-9A-Za-z]|\x1b[=>78MDEHc]')
CTRL = re.compile(r'[\x00-\x1f\x7f]')
ROW = re.compile(r'KM (\d+) (\d+) ')            # R reply row: "KM <offset> <chars> <base64> <offset>."
END = re.compile(r'KM E (\d+) (\d+)\.')         # end of one R reply
B64 = re.compile(r'[A-Za-z0-9+/=]*')

buf = carry = ""
started = False   # the helper runs: on failure tell it to quit (it restores the remote tty)


def log(msg):
    if LOG:
        with open(LOG, "a") as f:
            f.write(f"{time.time():.2f} {msg}\n")


def send(b):
    while b:
        b = b[os.write(1, b):]


def fail(msg):
    log("FAIL " + msg)
    if started:
        try:
            send(b"Q\n")
        except OSError:
            pass
    sys.exit(1)


def finish(msg):
    send(b"Q\n")
    log("done " + msg)
    sys.exit(0)


def dig(b):
    return hashlib.sha256(b).hexdigest()[:32]   # first 32 hex = the helper's `sha256sum | cut -c1-32`


def pump(timeout):
    """Read pane output (if any arrives within timeout) into buf, cleaned. True if something arrived."""
    global buf, carry
    if not select.select([0], [], [], timeout)[0]:
        return False
    d = os.read(0, 65536)
    if not d:
        fail("pane stream closed")
    s = ESC.sub("", carry + d.decode("latin1"))
    carry = ""
    k = s.rfind("\x1b")
    if k >= 0 and len(s) - k <= 64:              # probably an escape split across reads: keep for next time
        carry, s = s[k:], s[:k]
    buf += CTRL.sub("", s)
    return True


def wait_for(rx, timeout):
    """Search the pane output for a (short) reply rx, consume through the match; None on timeout."""
    global buf
    end = time.time() + timeout
    while True:
        if m := rx.search(buf):
            buf = buf[m.end():]
            return m
        buf = buf[-65536:]                       # replies are short: don't hoard noise
        if (left := end - time.time()) <= 0:
            return None
        pump(min(left, 0.5))


def hello(timeout):
    """Type in the helper (the remote line already said KMREADY); return (size, row width) from its KMGO."""
    global started
    with open(os.path.join(HERE, "kmodem-helper.sh"), "rb") as f:
        send(base64.encodebytes(gzip.compress(f.read())) + b"\x04")
    if not (m := wait_for(re.compile(r"KMGO (\d+) (\d+)\."), timeout)):
        fail("remote helper did not start")
    started = True
    return int(m[1]), int(m[2])


def ask(off, n):
    """sha of the remote's n bytes at off; re-ask on timeout (asking is idempotent)."""
    for _ in range(5):
        send(b"C %d %d\n" % (off, n))
        if m := wait_for(re.compile(r"KA c %d %d ([0-9a-f]{32})\." % (off, n)), TMO):
            return m[1]
    fail("remote not answering")


def verify(size, local, repair):
    """End-to-end: one sha256 of the whole file; only on a mismatch narrow down per block and repair those."""
    for attempt in range(6):
        if ask(0, size) == local(0, size):
            return
        bad = [(o, min(BLK, size - o)) for o in range(0, size, BLK)]
        bad = [(o, n) for o, n in bad if ask(o, n) != local(o, n)]
        log(f"pass {attempt}: whole-file mismatch, bad blocks {[o // BLK for o, _ in bad][:10]}")
        for o, n in bad:
            repair(o, n)
    fail("still mismatching after 6 passes")


def parse_rows(rows, fw):
    """Move complete R rows from buf into rows {offset: bytes}; return the end markers seen. A row must have a
    plausible length (<= fw: a spliced header can't make us wait for data that never comes), end with " <offset>."
    (a truncated row can't swallow the next row's "KM", a header glued from pieces can't fake its offset) and
    decode. Anything else is skipped: asked for again later."""
    global buf
    ends, pos = [], 0
    while True:
        i = buf.find("KM ", pos)
        if i < 0:
            pos = max(pos, len(buf) - 2)
            break
        if m := END.match(buf, i):
            ends.append((int(m[1]), int(m[2])))
            pos = m.end()
            continue
        if m := ROW.match(buf, i):
            n, tail = int(m[2]), f" {m[1]}."
            end = m.end() + n
            if not 0 < n <= fw or n % 4:
                pos = i + 3
                continue
            if end + len(tail) > len(buf):       # incomplete row: wait for more
                pos = i
                break
            p = buf[m.end():end]
            pos = i + 3
            if buf.startswith(tail, end) and B64.fullmatch(p):
                try:
                    rows[int(m[1])] = base64.b64decode(p)
                    pos = end + len(tail)
                except ValueError:
                    pass
            continue
        if len(buf) - i < 40:                    # maybe an end marker split across reads
            pos = i
            break
        pos = i + 3
    buf = buf[pos:]
    return ends


def subtract(gaps, covered):
    out = []
    for g, n in gaps:
        cur, end = g, g + n
        for a, b in sorted(covered):
            if b <= cur or a >= end:
                continue
            if a > cur:
                out.append((cur, a - cur))
            cur = max(cur, b)
        if cur < end:
            out.append((cur, end - cur))
    return out


def fetch(fd, off, n, fw):
    """recv: get bytes [off, off+n) into fd. Request them, then re-request exactly the gaps until covered."""
    gaps, rounds = [(off, n)], 0
    while gaps:
        if (rounds := rounds + 1) > 50:
            fail(f"too much loss at byte {gaps[0][0]}")
        for g, k in gaps:
            send(b"R %d %d\n" % (g, k))
        rows, pending, last = {}, set(gaps), time.time()
        while pending and time.time() - last < TMO:   # until every reply ended, or the stream went quiet
            if pump(0.5):
                last = time.time()
            pending -= set(parse_rows(rows, fw))
        got = [(o, d) for o, d in rows.items() if any(g <= o and o + len(d) <= g + k for g, k in gaps)]
        for o, d in got:
            os.pwrite(fd, d, o)
        gaps = subtract(gaps, [(o, o + len(d)) for o, d in got])
        if gaps:
            log(f"retry block {off // BLK}: {len(gaps)} gaps, {sum(k for _, k in gaps)} bytes")


def do_recv():
    if not wait_for(re.compile("KMREADY"), 60):
        fail("remote shell not ready")
    size, fw = hello(IDLE)
    if not size:
        fail("empty input")
    log(f"recv {size} bytes, rows of {fw} chars")
    fd = os.open(OUT + ".part", os.O_RDWR | os.O_CREAT | os.O_TRUNC, 0o600)
    for off in range(0, size, BLK):
        fetch(fd, off, min(BLK, size - off), fw)
    verify(size, lambda o, n: dig(os.pread(fd, n, o)), lambda o, n: fetch(fd, o, n, fw))
    os.close(fd)
    os.replace(OUT + ".part", OUT)
    finish(f"received {size} bytes -> {OUT}")


def resolve(raw):
    """Prompt text -> existing file: shlex first (quotes, 'My\\ File'), else the raw text (unescaped spaces)."""
    cands = [raw.strip()]
    try:
        cands.insert(0, shlex.split(raw)[0])
    except (ValueError, IndexError):
        pass
    for c in cands:
        if os.path.isfile(p := os.path.expanduser(c)):
            return p


def do_send():
    raw = sys.argv[2] if len(sys.argv) > 2 else ""
    data, err = b"", None
    if not (path := resolve(raw)):
        err = "no such file: " + raw.strip()
    else:
        try:
            with open(path, "rb") as f:
                data = f.read()
        except OSError as e:
            err = str(e)
        if not err and not data:
            err = "empty file"
    if not wait_for(re.compile("KMREADY"), 60):
        fail("remote shell not ready")
    if err:
        send(b"\x04")                            # EOF: unblock the remote's `base64 -d </dev/tty` (no helper)
        fail(err)
    hello(30)
    lost = 0
    for i, off in enumerate(range(0, len(data), BLK)):
        send(b"W %d %s\n" % (off, base64.b64encode(data[off:off + BLK])))
        if (i + 1) % WIN == 0 or off + BLK >= len(data):
            send(b"P %d\n" % i)
            if not wait_for(re.compile(r"KA p %d\." % i), TMO):    # lost pong: just carry on
                lost += 1
                log(f"pong {i} timeout")
    log(f"streamed, lost pongs: {lost}")
    verify(len(data), lambda o, n: dig(data[o:o + n]),
           lambda o, n: send(b"W %d %s\n" % (o, base64.b64encode(data[o:o + n]))))
    finish(f"sent {len(data)} bytes -> remote ./kmodem.bin")


mode = sys.argv[1] if len(sys.argv) > 1 else ""
if mode == "recv":
    do_recv()
elif mode == "send":
    do_send()
else:
    sys.exit("usage: kmodem.py recv | send PATH")
