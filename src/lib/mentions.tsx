import Link from "next/link";
import { getExistingUsernames } from "@/lib/queries";

export const MENTION_RE = /@([a-z0-9-]{3,20})/g;

// Turns @username into a profile link for climbers who exist; unknown mentions
// stay plain text, so a nickname that happens to start with @ isn't a dead end.
function linkify(text: string, existing: Set<string>): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(MENTION_RE)) {
    const username = match[1];
    if (!existing.has(username)) continue;
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    nodes.push(
      <Link key={`${username}-${match.index}`} href={`/u/${username}`} className="mention">
        @{username}
      </Link>
    );
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

// Renders a free-text string, turning @username mentions into profile links.
export async function renderMentions(text: string): Promise<React.ReactNode[]> {
  const [only] = await renderMentionsAll([text]);
  return only;
}

// The same for several strings — the paragraphs of a story, say — resolving
// every mention in one query instead of one per paragraph.
export async function renderMentionsAll(texts: string[]): Promise<React.ReactNode[][]> {
  const mentioned = texts.flatMap((t) => [...t.matchAll(MENTION_RE)].map((m) => m[1]));
  const existing = await getExistingUsernames(mentioned);
  return texts.map((t) => linkify(t, existing));
}
