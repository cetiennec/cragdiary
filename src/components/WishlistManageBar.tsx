"use client";

import { useState } from "react";
import {
  deleteWishlist,
  renameWishlist,
  toggleWishlistVisibility,
} from "@/app/actions";

export type ManageBarLabels = {
  rename: string;
  renameSave: string;
  deleteList: string;
  deleteConfirm: string;
  visibilityPublic: string;
  visibilityPrivate: string;
  visibilityPublicHint: string;
  visibilityPrivateHint: string;
};

// Owner-only controls for one list: rename (inline), public/private toggle, and
// delete — hidden entirely for the default list, which can never be removed.
export default function WishlistManageBar({
  list,
  t,
}: {
  list: { id: string; name: string; visibility: string; is_default: boolean };
  t: ManageBarLabels;
}) {
  const [renaming, setRenaming] = useState(false);
  const isPublic = list.visibility === "public";

  return (
    <div className="wishlist-manage">
      {renaming ? (
        <form action={renameWishlist} className="wishlist-rename">
          <input type="hidden" name="id" value={list.id} />
          <input
            type="text"
            name="name"
            defaultValue={list.name}
            maxLength={80}
            autoFocus
            aria-label={t.rename}
          />
          <button type="submit">{t.renameSave}</button>
        </form>
      ) : (
        <button
          type="button"
          className="wishlist-rename-btn"
          onClick={() => setRenaming(true)}
          title={t.rename}
          aria-label={t.rename}
        >
          ✏️
        </button>
      )}

      <form action={toggleWishlistVisibility}>
        <input type="hidden" name="id" value={list.id} />
        <button
          type="submit"
          className={`wishlist-visibility${isPublic ? "" : " private"}`}
          title={isPublic ? t.visibilityPublicHint : t.visibilityPrivateHint}
        >
          {isPublic ? t.visibilityPublic : t.visibilityPrivate}
        </button>
      </form>

      {!list.is_default && (
        <form
          action={deleteWishlist}
          onSubmit={(e) => {
            if (!confirm(t.deleteConfirm)) e.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={list.id} />
          <button type="submit" className="delete-btn">
            {t.deleteList}
          </button>
        </form>
      )}
    </div>
  );
}
