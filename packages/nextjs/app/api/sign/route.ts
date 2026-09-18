import { NextResponse } from "next/server";
import { keccak256, stringToBytes } from "viem";
import { pending, put } from "~~/utils/signQueue";

export const dynamic = "force-dynamic";

// POST {message}: the page asks the chip to sign. Returns the request to poll on.
export async function POST(req: Request) {
  if (process.env.VERCEL && !process.env.UPSTASH_REDIS_REST_URL) {
    return NextResponse.json(
      { error: "this deployment has no queue; run `yarn start` on a laptop the Pico can reach, or set Upstash" },
      { status: 503 },
    );
  }
  const { message } = (await req.json()) as { message?: string };
  if (typeof message !== "string" || !message.trim() || message.length > 200) {
    return NextResponse.json({ error: "message: 1 to 200 characters" }, { status: 400 });
  }
  const r = {
    id: crypto.randomUUID().slice(0, 8),
    message,
    hash: keccak256(stringToBytes(message)),
    status: "pending" as const,
    createdAt: Date.now(),
  };
  await put(r);
  return NextResponse.json(r);
}

// GET: what the Pico polls. The newest pending request, or {}.
export async function GET() {
  const r = await pending();
  return NextResponse.json(r ? { id: r.id, message: r.message, hash: r.hash } : {});
}
