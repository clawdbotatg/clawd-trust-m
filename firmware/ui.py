# Screen for the Trust M on a Waveshare Pico-LCD-1.3 hat: show a message, sign it on A, refuse on B.
# Driven from the host by tools/chip.py ui. Nothing here talks to the network; the host checks
# the chain and calls verdict() to put the answer on the screen.
import gc
import sys
import time

from lcd import LCD, Keys, BLACK, WHITE, RED, GREEN, GREY, DARK, YELLOW
import trustm

KEY_OID = 0xE0F0
session = None     # the Session run() opened; the host's earlier session is dead after that reset
d = None
keys = None


def _init():
    global d, keys
    w = sys.modules.get("wallet")      # the picowallet loop owns the screen at boot; take it over
    if w and getattr(w, "timer", None):
        try:
            w.stop()
        except Exception:
            pass
    if d is None:
        gc.collect()
        # the wallet's framebuffer is 115 KB and the Pico has no room for a second one: reuse it
        d = w.d if w and getattr(w, "d", None) else LCD()
        keys = Keys()
    return d


def _header(title, c=WHITE):
    d.fill(BLACK)
    d.fill_rect(0, 0, 240, 22, DARK)
    d.text("INFINEON TRUST M", 6, 7, GREY)
    d.text(title, 240 - 6 - 8 * len(title), 7, c)


def _lines(s, scale):
    n = 240 // (8 * scale) - 1
    out, cur = [], ""
    for w in s.split(" "):
        while len(w) > n:
            if cur:
                out.append(cur)
                cur = ""
            out.append(w[:n])
            w = w[n:]
        if not cur:
            cur = w
        elif len(cur) + 1 + len(w) <= n:
            cur += " " + w
        else:
            out.append(cur)
            cur = w
    if cur:
        out.append(cur)
    return out


def _message(s, y0=34, h=110):
    """The text being signed, as big as fits in the box."""
    for scale in (3, 2, 1):
        ls = _lines(s, scale)
        if len(ls) * 10 * scale <= h:
            break
    ls = ls[: h // (10 * scale)]
    y = y0 + (h - len(ls) * 10 * scale) // 2
    for l in ls:
        d.center_text(l, y, WHITE, scale)
        y += 10 * scale


def _bar(x, w, label, c):
    d.fill_rect(x, 200, w, 40, c)
    d.text(label, x + (w - 8 * len(label)) // 2, 216, BLACK)


def _hex(label, y, v):
    d.text(label, 6, y, GREY)
    d.text(v[:28], 6 + 8 * (len(label) + 1), y, WHITE)


def confirm(text, digest):
    _header("SIGN HASH?", YELLOW)
    _message(text)
    d.center_text("relay/host-provided text", 144, GREY)
    # Show all 64 hex characters without clipping them behind a label.
    h = digest.hex()
    for i in range(3):
        d.text(h[i * 28:(i + 1) * 28], 6, 158 + i * 12, WHITE)
    _bar(0, 118, "A  SIGN", GREEN)
    _bar(122, 118, "B  REFUSE", RED)
    d.show()


def busy(text):
    _header("SIGNING", YELLOW)
    _message(text)
    d.center_text("asking the chip...", 170, GREY)
    d.show()


def signed(text, r, s):
    _header("SIGNED", GREEN)
    _message(text, 30, 80)
    _hex("r", 128, "%064x" % r)
    _hex(" ", 140, ("%064x" % r)[28:56])
    _hex("s", 156, "%064x" % s)
    _hex(" ", 168, ("%064x" % s)[28:56])
    d.center_text("key never left the chip", 190, GREY)
    d.center_text("checking mainnet...", 210, YELLOW)
    d.show()


def refused(text):
    _header("REFUSED", RED)
    _message(text)
    d.center_text("nothing signed", 170, GREY)
    d.show()


def verdict(text, ok):
    _init()                                          # called from a fresh exec on the host, after run()
    if ok is None:
        _header("UNAVAILABLE", YELLOW)
        _message(text, 30, 70)
        d.center_text("verification unavailable", 128, YELLOW)
        d.center_text("no confirmed chain result", 160, WHITE)
        d.show()
        return
    c = GREEN if ok else RED
    _header("MAINNET", c)
    _message(text, 30, 70)
    d.center_text("REAL CHIP" if ok else "REJECTED", 112, c, 3)
    d.center_text("TrustMAttest says %s" % ("true" if ok else "false"), 160, WHITE)
    d.center_text("0xA2b53f0c...dA1E197", 180, GREY)
    d.center_text("ethereum mainnet", 196, GREY)
    d.show()


def run(text, digest, timeout_ms=300000, autosign=False):
    """Show text and its digest, wait for A (sign) or B (refuse). Returns (r, s) or None."""
    _init()
    confirm(text, digest)
    keys.pressed()                                   # drop edges from before the screen came up
    t0 = time.ticks_ms()
    while not autosign:
        p = keys.pressed()
        if "A" in p or "press" in p:
            break
        if "B" in p or time.ticks_diff(time.ticks_ms(), t0) > timeout_ms:
            refused(text)
            return None
        time.sleep_ms(20)
    global session
    busy(text)
    trustm.bus()
    session = trustm.Session()                       # fresh session: the chip may have been idle for minutes
    r, sg = session.sign(KEY_OID, digest)
    signed(text, r, sg)
    return r, sg
