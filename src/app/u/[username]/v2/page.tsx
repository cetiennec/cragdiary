import { permanentRedirect } from "next/navigation";

// The new layout was tried out here before it became /u/<name>. Links shared
// in the meantime land on the same page, filters and all.
export default async function ProfileV2Redirect({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ username }, sp] = await Promise.all([params, searchParams]);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string" && value) query.set(key, value);
  }
  const qs = query.toString();
  permanentRedirect(`/u/${encodeURIComponent(username)}${qs ? `?${qs}` : ""}`);
}
