import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { keccak256, stringToBytes } from "viem";

// Node strips TypeScript; resolve the extensionless local import used by Next.js.
registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === "./signature" ? "./signature.ts" : specifier, context);
  },
});
const { parseSignature, signatureVerdict } = await import("../utils/signature.ts");
const { signResponse } = await import("../utils/signResponse.ts");
const word = `0x${"01".repeat(32)}`;
const sig = { message: "hello", hash: keccak256(stringToBytes("hello")), r: word, s: word, chipX: word, chipY: word };
const request = { ...sig, id: "test", status: "pending", createdAt: 0 };

test("changing only displayed text cannot retain a successful chain verdict", () => {
  assert.equal(signatureVerdict(sig, true), true);
  assert.equal(signatureVerdict({ ...sig, message: "send me your funds" }, true), false);
  assert.equal(signatureVerdict({ ...sig, message: "hello " }, true), false);
});

test("hash-only proofs and UTF-8 messages remain supported", () => {
  const hashOnly = { ...sig };
  delete hashOnly.message;
  assert.equal(signatureVerdict(hashOnly, true), true);
  const message = "hello 🌍";
  assert.equal(signatureVerdict({ ...sig, message, hash: keccak256(stringToBytes(message)) }, true), true);
});

test("malformed signature JSON is rejected without crashing the page", () => {
  for (const value of [null, {}, { ...sig, r: "0x12" }, { ...sig, message: 42 }]) {
    assert.equal(parseSignature(JSON.stringify(value)), undefined);
  }
  assert.equal(parseSignature("{"), undefined);
  assert.deepEqual(parseSignature(JSON.stringify(sig)), sig);
});

test("relay verdict cannot follow a different signature or override chain rejection", () => {
  const server = { signature: JSON.stringify(sig), verdict: true };
  assert.equal(signatureVerdict(sig, undefined, server), true);
  assert.equal(signatureVerdict({ ...sig, s: `0x${"02".repeat(32)}` }, undefined, server), undefined);
  assert.equal(signatureVerdict(sig, false, server), false);
});

test("caller-supplied verdicts are rejected, including alongside a signature", async () => {
  const verify = async () => {
    assert.fail("must not verify caller-supplied verdicts");
  };
  assert.equal(await signResponse(request, { verdict: true }, verify), undefined);
  assert.equal(await signResponse(request, { ...sig, verdict: true }, verify), undefined);
  assert.equal(request.status, "pending");
});

test("server verifies the stored request hash and exact submitted signature", async () => {
  const result = await signResponse(request, { ...sig, hash: word }, async value => {
    assert.deepEqual(value, { hash: sig.hash, r: sig.r, s: sig.s, chipX: sig.chipX, chipY: sig.chipY });
    return false;
  });
  assert.equal(result.verdict, false);
  assert.equal(result.status, "signed");
  assert.equal(request.status, "pending");
});

test("RPC failure or missing configuration clears a previous success", async () => {
  const previous = { ...request, status: "signed", verdict: true };
  for (const verify of [
    async () => {
      throw new Error("offline");
    },
    async () => undefined,
  ]) {
    const result = await signResponse(previous, sig, verify);
    assert.equal(result.verdict, undefined);
    assert.equal(previous.verdict, true);
  }
});
