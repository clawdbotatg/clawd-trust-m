import type { SignRequest } from "./signQueue";
import { hex32 } from "./signature";

type Verify = (sig: {
  chipX: `0x${string}`;
  chipY: `0x${string}`;
  hash: `0x${string}`;
  r: `0x${string}`;
  s: `0x${string}`;
}) => Promise<boolean | undefined>;

export async function signResponse(
  request: SignRequest,
  body: unknown,
  verify: Verify,
): Promise<SignRequest | undefined> {
  if (!body || typeof body !== "object" || "verdict" in body) return undefined;
  if ("refused" in body && body.refused === true) {
    return {
      ...request,
      status: "refused",
      verdict: undefined,
      r: undefined,
      s: undefined,
      chipX: undefined,
      chipY: undefined,
    };
  }
  if (!("r" in body && "s" in body && "chipX" in body && "chipY" in body)) return undefined;
  if (!hex32(body.r) || !hex32(body.s) || !hex32(body.chipX) || !hex32(body.chipY)) return undefined;
  const sig = { r: body.r, s: body.s, chipX: body.chipX, chipY: body.chipY, hash: request.hash };
  let verdict: boolean | undefined;
  try {
    verdict = await verify(sig);
  } catch {
    // An unavailable RPC must not preserve a previous signature's successful verdict.
    verdict = undefined;
  }
  return { ...request, ...sig, status: "signed", verdict };
}
