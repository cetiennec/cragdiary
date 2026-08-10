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
  t,
}: {
  wishId: string;
  partners: string;
  partnersNode?: React.ReactNode;
  t: {
    placeholder: string;
    save: string;
    saved: string;
    edit: string;
    add: string;
  };
}) {
  const [editing, setEditing] = useState(false);
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
        defaultValue={partners}
        placeholder={t.placeholder}
        autoFocus
      />
      <button type="submit" className="wish-partners-save" disabled={pending}>
        {pending ? "…" : t.save}
      </button>
    </form>
  );
}
