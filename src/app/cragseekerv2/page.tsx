import { permanentRedirect } from "next/navigation";
import type { SeekerParams } from "@/components/Cragseeker";

// The new menu was tried out here before it became /cragseeker. Links shared
// in the meantime land on the same search.
export default async function CragseekerV2Redirect({
  searchParams,
}: {
  searchParams: Promise<SeekerParams>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const qs = query.toString();
  permanentRedirect(qs ? `/cragseeker?${qs}` : "/cragseeker");
}
