"use client";

import { useState } from "react";
import { updateWishPartners } from "@/app/actions";
import MentionInput from "@/components/MentionInput";

// Owner-side partners field on a wishlist row. Shows the saved partners as
// text (with @mentions rendered server-side and passed as a node), and only
// switches to an input on demand — so hitting "OK" visibly completes the list
// instead of leaving a raw input behind.
export default function WishPartnersEditor({
  wishId,
  partners,
  partnersNode,
  people,
  t,
}: {
  wishId: string;
  partners: string;
  partnersNode?: React.ReactNode;
  /** Everyone this list is already shared with. On a shared list they are the
      partners nine times out of ten, so they are offered as one tap rather
      than as something to type out again. */
  people?: { username: string; display_name: string }[];
  t: {
    placeholder: string;
    save: string;
    saved: string;
    edit: string;
    add: string;
  };
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(partners);
  const [pending, setPending] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  if (!editing) {
    if (!partners) {
      return (
        <button
          type="button"
          className="wish-partners-add"
          onClick={() => setEditing(true)}
        >
          {t.add}
        </button>
      );
    }
    return (
      <span className="wish-partners">
        👥 {partnersNode ?? partners}
        {justSaved && <em className="wish-partners-saved">{t.saved}</em>}
        <button
          type="button"
          className="wish-partners-edit"
          onClick={() => setEditing(true)}
          aria-label={t.edit}
          title={t.edit}
        >
          ✎
        </button>
      </span>
    );
  }

  return (
    <form
      className="wish-partners-form"
      action={async (formData: FormData) => {
        setPending(true);
        try {
          await updateWishPartners(formData);
          setEditing(false);
          setJustSaved(true);
          setTimeout(() => setJustSaved(false), 2500);
        } finally {
          setPending(false);
        }
      }}
    >
      <input type="hidden" name="id" value={wishId} />
      <MentionInput
        name="partners"
        value={text}
        onChange={setText}
        placeholder={t.placeholder}
        autoFocus
      />
      <button type="submit" className="wish-partners-save" disabled={pending}>
        {pending ? "…" : t.save}
      </button>
      {/* The people already on the list, one tap each. Typing still works —
          this is a shortcut, not a fence. */}
      {people && people.length > 0 && (
        <span className="wish-partners-people">
          {people.map((person) => {
            const already = new RegExp(`@${person.username}([^a-z0-9-]|$)`, "i").test(text);
            return (
              <button
                key={person.username}
                type="button"
                className={`wish-partner-chip${already ? " is-on" : ""}`}
                aria-pressed={already}
                onClick={() =>
                  setText((current) =>
                    already
                      ? current
                          .replace(new RegExp(`@${person.username}(?![a-z0-9-])`, "i"), "")
                          .replace(/\s*,\s*,/g, ",")
                          .replace(/^[\s,]+|[\s,]+$/g, "")
                      : current.trim()
                        ? `${current.replace(/[\s,]+$/, "")}, @${person.username}`
                        : `@${person.username}`
                  )
                }
              >
                {already ? "✓ " : "+ "}
                {person.display_name}
              </button>
            );
          })}
        </span>
      )}
    </form>
  );
}
