import { NextResponse } from "next/server";
import { get, put } from "~~/utils/signQueue";
import { signResponse } from "~~/utils/signResponse";
import { isChipSignature } from "~~/utils/verifyOnChain";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET: the page polls this until status leaves "pending"; the Pico polls it for the verdict.
export async function GET(_: Request, { params }: Params) {
  const r = await get((await params).id);
  return r ? NextResponse.json(r) : NextResponse.json({ error: "no such request" }, { status: 404 });
}

// POST from the Pico: {r, s, chipX, chipY} after A, {refused: true} after B.
// Verification results are computed by the server, never accepted from callers.
export async function POST(req: Request, { params }: Params) {
  const r = await get((await params).id);
  if (!r) return NextResponse.json({ error: "no such request" }, { status: 404 });
  const body: unknown = await req.json().catch(() => undefined);
  const updated = await signResponse(r, body, isChipSignature);
  if (!updated) {
    return NextResponse.json({ error: "expected {r,s,chipX,chipY} or {refused:true}" }, { status: 400 });
  }
  await put(updated);
  return NextResponse.json(updated);
}
