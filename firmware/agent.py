# The Pico as a signing device on the network. Polls the dApp's /api/sign for a request, shows it on
# the Pico-LCD-1.3, signs it with the Trust M when A is pressed, posts the signature back, then shows
# what mainnet said about it. Runs from main.py at boot.
#
# Needs secrets.py on the board with WIFI_SSID, WIFI_PASS and TRUSTM_RELAY (the dApp's base URL, the
# laptop running `yarn start`, e.g. "http://192.168.68.63:3000"). Nothing else is read from it.
import gc
import time

import network
import requests

import trustm
import ui
from lcd import WHITE, GREY, YELLOW, RED, GREEN

try:
    import secrets
except ImportError:
    secrets = None

N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
SPKI = bytes.fromhex("3059301306072a8648ce3d020106082a8648ce3d03010703420004")
POLL_MS = 1000
VERDICT_WAIT_MS = 45000

relay = getattr(secrets, "TRUSTM_RELAY", None) if secrets else None
chip_xy = None
ip = "-"


def wifi(timeout_s=20):
    global ip
    w = network.WLAN(network.STA_IF)
    w.active(True)
    if not w.isconnected() and secrets:
        w.connect(secrets.WIFI_SSID, secrets.WIFI_PASS)
        t0 = time.ticks_ms()
        while not w.isconnected() and time.ticks_diff(time.ticks_ms(), t0) < timeout_s * 1000:
            time.sleep_ms(200)
    ip = w.ifconfig()[0] if w.isconnected() else "-"
    return w.isconnected()


def chip_key():
    """(x, y) of the factory key, read from the certificate in E0E0."""
    global chip_xy
    if chip_xy is None:
        trustm.bus()
        s = trustm.Session()
        der = s.get_all(0xE0E0)
        i = der.find(SPKI) + 27
        chip_xy = ("0x" + der[i:i + 32].hex(), "0x" + der[i + 32:i + 64].hex())
    return chip_xy


def idle(note="", c=GREY):
    ui._init()
    d = ui.d
    ui._header("READY", GREEN)
    d.center_text("waiting for a request", 60, WHITE)
    d.center_text("from the website", 76, WHITE)
    d.text("relay", 6, 120, GREY)
    d.text((relay or "no TRUSTM_RELAY")[:28], 6, 132, WHITE)
    d.text("pico", 6, 152, GREY)
    d.text(ip, 6, 164, WHITE)
    if chip_xy:
        d.text("chip", 6, 184, GREY)
        d.text(chip_xy[0][:28], 6, 196, WHITE)
    if note:
        d.text(note[:29], 6, 224, c)
    d.show()


def _json(method, path, body=None):
    f = requests.post if method == "POST" else requests.get
    r = f(relay + path, json=body, timeout=8) if body is not None else f(relay + path, timeout=8)
    try:
        return r.json() if r.status_code < 300 else {}
    finally:
        r.close()


def handle(req):
    """Show one request, sign or refuse it, report back, then show the verdict."""
    rid, text, digest = req["id"], req["message"], bytes.fromhex(req["hash"][2:])
    rs = ui.run(text, digest, timeout_ms=300000)
    if rs is None:
        _json("POST", "/api/sign/" + rid, {"refused": True})
        time.sleep(2)
        return
    r, s = rs
    if s > N // 2:
        s = N - s
    x, y = chip_key()
    _json("POST", "/api/sign/" + rid, {"r": "0x%064x" % r, "s": "0x%064x" % s, "chipX": x, "chipY": y})
    t0 = time.ticks_ms()
    while time.ticks_diff(time.ticks_ms(), t0) < VERDICT_WAIT_MS:       # the page checks mainnet and posts back
        st = _json("GET", "/api/sign/" + rid)
        if "verdict" in st:
            ui.verdict(text, bool(st["verdict"]))
            time.sleep(8)
            return
        time.sleep_ms(POLL_MS)
    ui.verdict(text, False)
    ui.d.center_text("no verdict from the page", 220, YELLOW)
    ui.d.show()
    time.sleep(5)


def run():
    ui._init()
    idle("joining wifi...", YELLOW)
    ok = wifi()
    idle("" if ok else "wifi failed", GREY if ok else RED)
    try:
        chip_key()
        idle()
    except Exception as e:
        idle("chip: %s" % e, RED)
    seen = set()
    while True:
        try:
            if relay:
                req = _json("GET", "/api/sign")
                if req.get("id") and req["id"] not in seen:
                    seen.add(req["id"])
                    handle(req)
                    idle()
        except Exception as e:
            idle(("err %s" % e)[:29], RED)
        gc.collect()
        time.sleep_ms(POLL_MS)
