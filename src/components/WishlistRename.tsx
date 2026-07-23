"use client";

import { useState } from "react";
import { renameWishlist } from "@/app/actions";

// Inline rename control that sits next to the list name inside the <summary>.
// Clicks are stopped so they don't toggle the surrounding <details>.
export default function WishlistRename({
  list,
  t,
}: {
  list: { id: string; name: string };
  t: { rename: string; renameSave: string };
}) {
  const [editing, setEditing] = useState(false);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  if (editing) {
    return (
      <form action={renameWishlist} className="wishlist-rename" onClick={stop}>
        <input type="hidden" name="id" value={list.id} />
        <input
          type="text"
          name="name"
          defaultValue={list.name}
          maxLength={80}
          autoFocus
          aria-label={t.rename}
          onClick={stop}
        />
        <button type="submit" onClick={stop}>
          {t.renameSave}
        </button>
      </form>
    );
  }

  return (
    <button
      type="button"
      className="wishlist-rename-btn"
      title={t.rename}
      aria-label={t.rename}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setEditing(true);
      }}
    >
      ✏️
    </button>
  );
}
