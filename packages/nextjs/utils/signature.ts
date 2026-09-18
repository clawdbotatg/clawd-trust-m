import { keccak256, stringToBytes } from "viem";

export type Signature = {
  message?: string;
  hash: `0x${string}`;
  r: `0x${string}`;
  s: `0x${string}`;
  chipX: `0x${string}`;
  chipY: `0x${string}`;
};

export const hex32 = (v: unknown): v is `0x${string}` => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);

export const parseSignature = (text: string): Signature | undefined => {
  try {
    const value = JSON.parse(text);
    if (
      !value ||
      ![value.hash, value.r, value.s, value.chipX, value.chipY].every(hex32) ||
      (value.message !== undefined && typeof value.message !== "string")
    )
      return undefined;
    return value;
  } catch {
    return undefined;
  }
};

export const messageMatchesHash = (sig: Signature) =>
  sig.message === undefined || keccak256(stringToBytes(sig.message)).toLowerCase() === sig.hash.toLowerCase();

// A relay result belongs only to the exact payload it checked, never to the next pasted signature.
export const signatureVerdict = (
  sig: Signature,
  chainVerdict: boolean | undefined,
  serverResult?: { signature: string; verdict?: boolean },
): boolean | undefined => {
  if (!messageMatchesHash(sig)) return false;
  return chainVerdict ?? (serverResult?.signature === JSON.stringify(sig) ? serverResult.verdict : undefined);
};
