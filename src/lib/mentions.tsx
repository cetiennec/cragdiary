import Link from "next/link";
import { getExistingUsernames } from "@/lib/queries";

// Case-insensitive, since a username may now carry capitals — and a mention is
// written however its author felt like writing it.
export const MENTION_RE = /@([a-z0-9-]{3,20})/gi;

// Turns @username into a profile link for climbers who exist; unknown mentions
// stay plain text, so a nickname that happens to start with @ isn't a dead end.
// The link goes to the account's own spelling; the text keeps the writer's.
function linkify(text: string, existing: Map<string, string>): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(MENTION_RE)) {
    const username = existing.get(match[1].toLowerCase());
    if (!username) continue;
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    nodes.push(
      <Link key={`${username}-${match.index}`} href={`/u/${username}`} className="mention">
        {match[0]}
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
  const mentioned = texts.flatMap((t) =>
    [...t.matchAll(MENTION_RE)].map((m) => m[1].toLowerCase())
  );
  const existing = await getExistingUsernames(mentioned);
  return texts.map((t) => linkify(t, existing));
}
