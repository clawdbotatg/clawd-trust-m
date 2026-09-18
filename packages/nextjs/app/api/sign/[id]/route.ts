import { NextResponse } from "next/server";
import { get, put } from "~~/utils/signQueue";
import { isChipSignature } from "~~/utils/verifyOnChain";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };
const hex32 = (v: unknown): v is `0x${string}` => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);

// GET: the page polls this until status leaves "pending"; the Pico polls it for the verdict.
export async function GET(_: Request, { params }: Params) {
  const r = await get((await params).id);
  return r ? NextResponse.json(r) : NextResponse.json({ error: "no such request" }, { status: 404 });
}

// POST from the Pico: {r, s, chipX, chipY} after A, {refused: true} after B.
// POST from the page: {verdict: boolean} once mainnet has answered.
export async function POST(req: Request, { params }: Params) {
  const r = await get((await params).id);
  if (!r) return NextResponse.json({ error: "no such request" }, { status: 404 });
  const body = (await req.json()) as Record<string, unknown>;
  if (body.refused === true) {
    r.status = "refused";
  } else if (typeof body.verdict === "boolean") {
    r.verdict = body.verdict;
  } else if (hex32(body.r) && hex32(body.s) && hex32(body.chipX) && hex32(body.chipY)) {
    Object.assign(r, { status: "signed", r: body.r, s: body.s, chipX: body.chipX, chipY: body.chipY });
    try {
      r.verdict = await isChipSignature({ chipX: body.chipX, chipY: body.chipY, hash: r.hash, r: body.r, s: body.s });
    } catch (e) {
      console.error("mainnet check failed", e); // the page still runs its own read; the Pico waits for a verdict
    }
  } else {
    return NextResponse.json({ error: "expected {r,s,chipX,chipY}, {refused:true} or {verdict}" }, { status: 400 });
  }
  await put(r);
  return NextResponse.json(r);
}
