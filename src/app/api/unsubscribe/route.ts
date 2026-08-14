import { NextResponse } from "next/server";
import { unsubscribe, verifyUnsubscribe } from "@/lib/email-notifications";

/**
 * One-click unsubscribe for mail clients (RFC 8058): the `List-Unsubscribe`
 * header on every email points here, and Gmail and friends POST to it when
 * someone uses their own "unsubscribe" button rather than ours.
 *
 * POST only, and deliberately: a GET is what scanners and link-previewers
 * follow on their own, which would switch a setting off on behalf of someone
 * who never asked. The human-facing link goes to /unsubscribe, which asks.
 */
export async function POST(request: Request) {
  const params = new URL(request.url).searchParams;
  const userId = params.get("u") ?? "";
  const kind = params.get("k") ?? "";
  const sig = params.get("s") ?? "";

  if (!verifyUnsubscribe(userId, kind, sig)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  await unsubscribe(userId, kind);
  return NextResponse.json({ ok: true });
}
