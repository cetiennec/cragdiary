import type { WishlistMember } from "@/lib/db";
import { leaveWishlist, removeWishlistMember } from "@/app/actions";
import InviteMemberForm from "@/components/InviteMemberForm";

export type MembersLabels = {
  ownerLabel: string;
  invite: string;
  invitePlaceholder: string;
  leave: string;
  removeMember: string;
};

// Collaborators on a list: owner chip + member chips. The owner gets an invite
// field and a remove ✕ on each member; a member (not owner) gets a "leave".
export default function WishlistMembers({
  listId,
  owner,
  members,
  isOwner,
  isMember,
  t,
}: {
  listId: string;
  owner: { username: string; display_name: string };
  members: WishlistMember[];
  isOwner: boolean;
  isMember: boolean;
  t: MembersLabels;
}) {
  return (
    <div className="wishlist-members">
      <span className="member-chip owner" title={t.ownerLabel}>
        👑 @{owner.username}
      </span>

      {members.map((m) => (
        <span key={m.id} className="member-chip">
          {m.has_avatar && (
            /* eslint-disable-next-line @next/next/no-img-element -- our own avatar route */
            <img src={`/api/avatars/${m.username}`} alt="" className="member-avatar" />
          )}
          @{m.username}
          {isOwner && (
            <form action={removeWishlistMember} className="member-remove">
              <input type="hidden" name="id" value={listId} />
              <input type="hidden" name="member_id" value={m.id} />
              <button type="submit" aria-label={t.removeMember} title={t.removeMember}>
                ×
              </button>
            </form>
          )}
        </span>
      ))}

      {isOwner && (
        <InviteMemberForm
          listId={listId}
          t={{ invite: t.invite, invitePlaceholder: t.invitePlaceholder }}
        />
      )}

      {isMember && (
        <form action={leaveWishlist} className="member-leave">
          <input type="hidden" name="id" value={listId} />
          <button type="submit" className="delete-btn">
            {t.leave}
          </button>
        </form>
      )}
    </div>
  );
}
