import type { Metadata } from "next";
import { ProfileView, generateMetadata as profileMetadata } from "../profile-view";

// The new profile layout, tried here before it replaces /u/<name>. Same
// journal, so kept out of search results: the original address is the one to
// index.
export async function generateMetadata(props: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  return { ...(await profileMetadata(props)), robots: { index: false, follow: true } };
}

export default function ProfileV2Page(props: Omit<Parameters<typeof ProfileView>[0], "v2">) {
  return ProfileView({ ...props, v2: true });
}
