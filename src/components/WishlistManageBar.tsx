"use client";

import { deleteWishlist, toggleWishlistVisibility } from "@/app/actions";

export type ManageBarLabels = {
  deleteList: string;
  deleteConfirm: string;
  visibilityPublic: string;
  visibilityPrivate: string;
  visibilityPublicHint: string;
  visibilityPrivateHint: string;
};

// Owner-only controls for one list: public/private toggle and delete — hidden
// entirely for the default list, which can never be removed. (Rename lives in
// the header next to the name, see WishlistRename.)
export default function WishlistManageBar({
  list,
  t,
}: {
  list: { id: string; visibility: string; is_default: boolean };
  t: ManageBarLabels;
}) {
  const isPublic = list.visibility === "public";

  return (
    <div className="wishlist-manage">
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
