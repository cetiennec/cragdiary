"use client";

import { useState } from "react";
import { createWishlist } from "@/app/actions";

// A collapsed "＋ New list" button that opens an inline name field.
export default function CreateWishlistForm({
  t,
}: {
  t: { newList: string; newListPlaceholder: string; newListCreate: string };
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        className="wishlist-new-btn"
        onClick={() => setOpen(true)}
      >
        {t.newList}
      </button>
    );
  }

  return (
    <form action={createWishlist} className="wishlist-new-form">
      <input
        type="text"
        name="name"
        placeholder={t.newListPlaceholder}
        maxLength={80}
        autoFocus
        required
      />
      <button type="submit" className="btn-primary">
        {t.newListCreate}
      </button>
    </form>
  );
}
