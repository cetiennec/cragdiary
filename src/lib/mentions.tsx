import Link from "next/link";
import { getExistingUsernames } from "@/lib/queries";

export const MENTION_RE = /@([a-z0-9-]{3,20})/g;

// Renders a free-text partners string, turning @username mentions of real
// climbers into profile links; unknown mentions stay plain text.
export async function renderMentions(text: string): Promise<React.ReactNode[]> {
  const mentioned = [...text.matchAll(MENTION_RE)].map((m) => m[1]);
  const existing = await getExistingUsernames(mentioned);

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(MENTION_RE)) {
    const username = match[1];
    if (!existing.has(username)) continue;
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    nodes.push(
      <Link key={`${username}-${match.index}`} href={`/u/${username}`}>
        @{username}
      </Link>
    );
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
