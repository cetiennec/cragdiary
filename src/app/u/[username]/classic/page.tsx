import type { Metadata } from "next";
import { ProfileView, generateMetadata as profileMetadata } from "../profile-view";

// The profile layout before v2, kept at its own address. Same journal as
// /u/<name>, so kept out of search results.
export async function generateMetadata(props: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  return { ...(await profileMetadata(props)), robots: { index: false, follow: true } };
}

export default function ProfileClassicPage(props: Omit<Parameters<typeof ProfileView>[0], "v2">) {
  return ProfileView(props);
}
