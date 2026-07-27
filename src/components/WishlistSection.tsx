import Link from "next/link";
import type { ReactNode } from "react";
import type { Wish, WishlistFull } from "@/lib/db";
import type { Dict, Locale } from "@/lib/i18n";
import { deleteWish } from "@/app/actions";
import WishForm from "@/components/WishForm";
import WishPartnersEditor from "@/components/WishPartnersEditor";
import WishlistManageBar from "@/components/WishlistManageBar";
import WishlistMembers from "@/components/WishlistMembers";
import WishlistRename from "@/components/WishlistRename";

type WishlistDict = Dict["wishlist"];

// One named wishlist rendered as a collapsible block: header (name, count,
// owner/shared cues) + collaborators + routes + an add-route form. `wishes` is
// already filtered/sorted by the caller. Editing follows `list.can_edit`
// (owner or member); list management (rename/delete/share) is owner-only.
export default function WishlistSection({
  list,
  wishes,
  isOwner,
  partnerNodes,
  locale,
  t,
  attribution,
}: {
  list: WishlistFull;
  wishes: Wish[];
  isOwner: boolean;
  partnerNodes: Map<string, ReactNode>;
  locale: Locale;
  t: WishlistDict;
  attribution: string;
}) {
  const canEdit = list.can_edit;
  const isMember = canEdit && !isOwner;
  const shared = list.members.length > 0;
  // The default list can never be shared.
  const shareable = !list.is_default;

  return (
    <details className="wishlist-list" open>
      <summary className="wishlist-list-summary">
        <span className="wishlist-list-name">{list.name}</span>
        {isOwner && (
          <WishlistRename list={list} t={{ rename: t.rename, renameSave: t.renameSave }} />
        )}
        <span className="wishlist-list-count">{list.wishes.length}</span>
        {shared && <span className="wishlist-list-badge" title={t.invite}>🤝</span>}
        {list.visibility !== "public" && <span className="wishlist-list-badge">🔒</span>}
        {!isOwner && (
          <span className="wishlist-list-owner">
            {t.sharedBy} @{list.owner_username}
          </span>
        )}
      </summary>

      {isOwner && (
        <WishlistManageBar
          list={list}
          t={{
            deleteList: t.deleteList,
            deleteConfirm: t.deleteConfirm,
            visibilityPublic: t.visibilityPublic,
            visibilityPrivate: t.visibilityPrivate,
            visibilityPublicHint: t.visibilityPublicHint,
            visibilityPrivateHint: t.visibilityPrivateHint,
          }}
        />
      )}

      {shareable && (isOwner || shared) && (
        <WishlistMembers
          listId={list.id}
          owner={{ username: list.owner_username, display_name: list.owner_display_name }}
          members={list.members}
          isOwner={isOwner}
          isMember={isMember}
          t={{
            ownerLabel: t.ownerLabel,
            invite: t.invite,
            invitePlaceholder: t.invitePlaceholder,
            leave: t.leave,
            removeMember: t.removeMember,
          }}
        />
      )}

      {canEdit && (
        <WishForm
          locale={locale}
          wishlistId={list.id}
          t={{
            titlePlaceholder: t.titlePlaceholder,
            notePlaceholder: t.notePlaceholder,
            partnersPlaceholder: t.partnersPlaceholder,
            add: t.add,
            attribution,
          }}
        />
      )}

      {wishes.length === 0 && <p className="form-hint">{t.empty}</p>}

      <ul className="wishlist">
        {wishes.map((wish) => (
          <li key={wish.id} className="wish-row">
            <div className="wish-main">
              <span className="wish-title">
                {wish.c2c_url ? (
                  <a href={wish.c2c_url} target="_blank" rel="noopener noreferrer">
                    {wish.title} ↗
                  </a>
                ) : (
                  wish.title
                )}
              </span>
              <span className="wish-meta">
                {[
                  wish.location,
                  wish.grade_max ?? wish.rating,
                  wish.height_m ? `${wish.height_m} m` : null,
                  wish.note,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
            {canEdit ? (
              <WishPartnersEditor
                wishId={wish.id}
                partners={wish.partners ?? ""}
                partnersNode={partnerNodes.get(wish.id)}
                t={{
                  placeholder: t.partnersPlaceholder,
                  save: t.savePartners,
                  saved: t.partnersSaved,
                  edit: t.editPartners,
                  add: t.addPartners,
                }}
              />
            ) : (
              wish.partners && (
                <span className="wish-partners">👥 {partnerNodes.get(wish.id)}</span>
              )
            )}
            {canEdit && (
              <div className="wish-actions">
                <Link href={`/entries/new?from_wish=${wish.id}`} className="wish-done">
                  {t.done}
                </Link>
                <form action={deleteWish}>
                  <input type="hidden" name="id" value={wish.id} />
                  <button type="submit" className="delete-btn">
                    {t.remove}
                  </button>
                </form>
              </div>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
