---
name: trust-m-attest
description: Sign with an Infineon OPTIGA Trust M chip on a Pico and prove on chain that the signature came from real silicon. Use for "sign this with the chip", "is this signature from the chip", "attest a new Trust M", or any Trust M / IFX I2C question.
---

# Trust M attestation

## What you have

- `firmware/trustm.py`: MicroPython driver. `trustm.bus()` then `trustm.Session()` (soft reset +
  OpenApplication). Session methods: `get(oid)`, `get_all(oid)`, `metadata(oid)`, `sign(oid, digest32)`,
  `random(n)`, `command(cmd, param, data)`.
- `tools/chip.py`: run from the host with the Pico on USB. `ui "text"` (needs the Pico-LCD-1.3 hat: shows
  the text, signs on A, checks mainnet, shows the verdict, opens the dApp with the signature in the URL
  hash; `--auto` skips the button), `uid`, `cert`, `sign "text"`, `sign 0x<hash>`. Prints JSON the dApp
  and the contract take as is.
- `firmware/ui.py` + `firmware/lcd.py`: the screens. `ui.run(text, digest)` returns `(r, s)` or None.
- `firmware/agent.py` (run by `main.py`): WiFi + polls `TRUSTM_RELAY/api/sign` (from `secrets.py`), shows the
  request, signs on A, POSTs `{r,s,chipX,chipY}` to `/api/sign/<id>`, then polls for `verdict`. The queue is
  `packages/nextjs/app/api/sign` + `utils/signQueue.ts` (memory, or Upstash when the env vars are set).
  The board also carries `main_picowallet.py`, the previous boot file; swap them back to get picowallet.
- `TrustMAttest` on mainnet at `0xA2b53f0c5c700E42020d91a1c0E481389dA1E197`. `attest(...)` once per
  chip, `isChipSignature(x, y, hash, r, s)` any time.

## Rules that are not obvious

1. An I2C scan shows nothing. The chip NACKs while asleep or busy. Retry on NACK (1 ms, up to 200x) and
   keep 50 µs between transactions. The driver does this; do not "debug the wiring" from a scan.
2. Check wire colours with a meter, not by convention. See README.
3. `Session()` resets the chip; frame numbers restart. Make one session per job.
4. The factory key is slot 0xE0F0, its certificate 0xE0E0. Both are read-only forever. Slots 0xE0F1 to
   0xE0F3 are free for your own keys (GenKeyPair, command 0x38, not in the driver yet).
5. ECDSA signatures may have high s. `chip.py` folds s to N-s; the contract does too.
6. `sign` takes a 32-byte digest and signs it as is. Use keccak256 for Ethereum.
7. Nothing else may touch the I2C bus while you talk to the chip. `chip.py` stops the picowallet loop
   first. A chip that acks its address in a scan but NACKs every write is stuck; only a power cycle fixes it.
8. The Pico has room for one 240x240 framebuffer. `ui.py` reuses the wallet's if it exists.

## Prove a signature on chain

```
tools/chip.py sign "hello"    -> {hash, r, s, chipX, chipY}
cast call 0xA2b53f0c5c700E42020d91a1c0E481389dA1E197 \
  "isChipSignature(bytes32,bytes32,bytes32,bytes32,bytes32)(bool)" $chipX $chipY $hash $r $s \
  --rpc-url $MAINNET_RPC
```

## Attest a new chip

```
tools/chip.py cert            -> {issuer, chipX, chipY, attest:{cert, tbsStart, tbsLen, pkOffset, r, s}}
```
If `issuer` is not "Trust M CA 101", deploy a new contract with that CA's key (see README). Then send
`attest(cert, tbsStart, tbsLen, pkOffset, r, s)` from any wallet, or paste the JSON into the dApp.

## Don't

- Don't run anything that writes chip metadata or lifecycle (SetObjectProtected, lifecycle changes) without
  reading the object back first and getting an explicit yes. Lifecycle only moves forward.
- Don't use public RPCs. Alchemy with a key.
