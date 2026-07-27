import { currentUser } from "@/lib/auth";
import { c2cImageUrl, isC2cFilename, type C2cImageSize } from "@/lib/c2c";

// Proxy a public c2c image so the editor can fetch it without CORS. The
// filename is strictly validated, so this can only ever hit the fixed c2c
// media host — no open proxy / SSRF.
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const filename = searchParams.get("f") ?? "";
  if (!isC2cFilename(filename)) {
    return new Response("Bad filename", { status: 400 });
  }
  const rawSize = searchParams.get("size") ?? "BI";
  const size: C2cImageSize = ["", "BI", "MI", "SI"].includes(rawSize)
    ? (rawSize as C2cImageSize)
    : "BI";

  try {
    const upstream = await fetch(c2cImageUrl(filename, size), {
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok || !upstream.body) {
      return new Response("Upstream error", { status: 502 });
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("Fetch failed", { status: 502 });
  }
}
