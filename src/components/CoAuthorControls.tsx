"use client";

import { useEffect, useState, useTransition } from "react";
import type { CoAuthorCandidate } from "@/app/api/entries/coauthors/route";
import { inviteCoAuthor, removeCoAuthor } from "@/app/actions";

export type CoAuthorLabels = {
  /** "Let them write this day too" */
  offer: string;
  invited: string;
  writing: string;
  withdraw: string;
  /** Why the offer is greyed for this person. */
  needsMutual: string;
  /** Shown on a day that has not been saved yet. */
  saveFirst: string;
  hint: string;
};

/** The usernames written with an @ in a free-text partners field. */
function mentions(text: string): string[] {
  return [...new Set([...text.matchAll(/@([a-z0-9-]{3,20})/gi)].map((m) => m[1].toLowerCase()))];
}

/**
 * Beside the rope party, one line per climber named on the day: offer them the
 * pen, or take it back.
 *
 * Being named and co-writing are two different things, and this is the seam
 * between them — a mention opens the day to someone and lends their photographs
 * to it, which is most of what anyone wants; the pen is the deliberate extra
 * step, and it is only ever offered between two people who follow each other.
 *
 * A day with no id yet has nothing to invite anyone onto, so this waits for the
 * first save rather than inventing a queue of invitations to send later.
 */
export default function CoAuthorControls({
  entryId,
  partners,
  t,
}: {
  entryId: string | null;
  partners: string;
  t: CoAuthorLabels;
}) {
  const [people, setPeople] = useState<CoAuthorCandidate[]>([]);
  // Bumped after an invitation is sent or taken back, to ask the server again
  // rather than guess at the new state.
  const [reloadTick, setReloadTick] = useState(0);
  const [pending, startTransition] = useTransition();
  const named = mentions(partners);
  const key = named.join(",");

  useEffect(() => {
    if (!entryId || key.length === 0) return;
    // The names change as you type; the answer to a name you have already
    // deleted must not overwrite the answer to the one you are writing.
    let live = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/entries/coauthors?entry=${encodeURIComponent(entryId)}&users=${encodeURIComponent(key)}`
        );
        if (!res.ok) return;
        const data = (await res.json()) as { people: CoAuthorCandidate[] };
        if (live) setPeople(data.people);
      } catch {
        // Not being offered the control is no worse than before it existed.
      }
    })();
    return () => {
      live = false;
    };
  }, [entryId, key, reloadTick]);

  if (named.length === 0) return null;
  if (!entryId) return <p className="form-hint">{t.saveFirst}</p>;
  // Only the climbers still named: a row for someone just deleted from the
  // field would outlive the mention it came from.
  const shown = people.filter((p) => named.includes(p.username.toLowerCase()));
  if (shown.length === 0) return null;

  function act(action: (data: FormData) => Promise<void>, username: string) {
    const data = new FormData();
    data.set("entry_id", entryId as string);
    data.set("username", username);
    startTransition(async () => {
      await action(data);
      setReloadTick((n) => n + 1);
    });
  }

  return (
    <div className="coauthors">
      <p className="form-hint">{t.hint}</p>
      <ul className="coauthor-list">
        {shown.map((p) => (
          <li key={p.username} className="coauthor-row">
            <span className="coauthor-name">{p.display_name}</span>
            {p.status === "accepted" ? (
              <>
                <span className="coauthor-state">{t.writing}</span>
                <button
                  type="button"
                  className="follower-remove"
                  disabled={pending}
                  onClick={() => act(removeCoAuthor, p.username)}
                >
                  {t.withdraw}
                </button>
              </>
            ) : p.status === "pending" ? (
              <>
                <span className="coauthor-state">{t.invited}</span>
                <button
                  type="button"
                  className="follower-remove"
                  disabled={pending}
                  onClick={() => act(removeCoAuthor, p.username)}
                >
                  {t.withdraw}
                </button>
              </>
            ) : p.mutual ? (
              <button
                type="button"
                className="follower-accept"
                disabled={pending}
                onClick={() => act(inviteCoAuthor, p.username)}
              >
                {t.offer}
              </button>
            ) : (
              <span className="coauthor-state">{t.needsMutual}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
