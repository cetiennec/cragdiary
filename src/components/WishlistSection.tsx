import Link from "next/link";
import type { ReactNode } from "react";
import type { Wish, WishlistWithWishes } from "@/lib/db";
import type { Dict, Locale } from "@/lib/i18n";
import { deleteWish } from "@/app/actions";
import WishForm from "@/components/WishForm";
import WishPartnersEditor from "@/components/WishPartnersEditor";
import WishlistManageBar from "@/components/WishlistManageBar";

type WishlistDict = Dict["wishlist"];

// One named wishlist rendered as a collapsible block: header (name, count, and
// owner controls) + its routes + an add-route form. `wishes` is already
// filtered/sorted by the caller; `canEdit` gates all mutation UI.
export default function WishlistSection({
  list,
  wishes,
  canEdit,
  partnerNodes,
  locale,
  t,
  attribution,
}: {
  list: WishlistWithWishes;
  wishes: Wish[];
  canEdit: boolean;
  partnerNodes: Map<string, ReactNode>;
  locale: Locale;
  t: WishlistDict;
  attribution: string;
}) {
  return (
    <details className="wishlist-list" open>
      <summary className="wishlist-list-summary">
        <span className="wishlist-list-name">{list.name}</span>
        <span className="wishlist-list-count">{list.wishes.length}</span>
        {!canEdit && list.visibility !== "public" && (
          <span className="wishlist-list-badge">🔒</span>
        )}
      </summary>

      {canEdit && (
        <WishlistManageBar
          list={list}
          t={{
            rename: t.rename,
            renameSave: t.renameSave,
            deleteList: t.deleteList,
            deleteConfirm: t.deleteConfirm,
            visibilityPublic: t.visibilityPublic,
            visibilityPrivate: t.visibilityPrivate,
            visibilityPublicHint: t.visibilityPublicHint,
            visibilityPrivateHint: t.visibilityPrivateHint,
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
    </details>
  );
}
