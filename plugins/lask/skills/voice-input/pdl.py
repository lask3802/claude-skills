"""Parallel HTTP range downloader: pdl.py <url> <out> [conns]. Resumes per-chunk."""
import os, sys, threading, urllib.request

url, out = sys.argv[1], sys.argv[2]
conns = int(sys.argv[3]) if len(sys.argv) > 3 else 16

req = urllib.request.Request(url, method="HEAD")
with urllib.request.urlopen(req) as r:
    final = r.geturl()
    size = int(r.headers["Content-Length"])
chunk = (size + conns - 1) // conns
parts = [(i, i * chunk, min(size, (i + 1) * chunk) - 1) for i in range(conns)]


def fetch(i, a, b):
    p = f"{out}.part{i}"
    for _ in range(30):
        have = os.path.getsize(p) if os.path.exists(p) else 0
        if a + have > b:
            return
        try:
            rq = urllib.request.Request(final, headers={"Range": f"bytes={a + have}-{b}"})
            with urllib.request.urlopen(rq, timeout=60) as r, open(p, "ab") as f:
                while True:
                    d = r.read(1 << 20)
                    if not d:
                        break
                    f.write(d)
        except Exception as e:
            print(f"part{i} retry: {e}", flush=True)
            # final URL is a signed, expiring redirect; re-resolve on failure
            global_refresh()
    raise SystemExit(f"part{i} failed")


def global_refresh():
    global final
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD")) as r:
            final = r.geturl()
    except Exception:
        pass


ts = [threading.Thread(target=fetch, args=p) for p in parts]
[t.start() for t in ts]
[t.join() for t in ts]
for i, a, b in parts:
    assert os.path.getsize(f"{out}.part{i}") == b - a + 1, f"part{i} size mismatch"
with open(out, "wb") as f:
    for i, _, _ in parts:
        with open(f"{out}.part{i}", "rb") as g:
            while d := g.read(1 << 24):
                f.write(d)
        os.remove(f"{out}.part{i}")
assert os.path.getsize(out) == size
print(f"OK {out} {size}", flush=True)
