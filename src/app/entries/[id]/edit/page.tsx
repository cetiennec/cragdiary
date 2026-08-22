import { notFound, redirect } from "next/navigation";
import { canEditEntry, getCoAuthors, getEntry, isProfileListed } from "@/lib/queries";
import { currentUser } from "@/lib/auth";
import { getDict } from "@/lib/i18n";
import EntryForm from "@/components/EntryForm";
import DeleteEntryButton from "@/components/DeleteEntryButton";

export default async function EditEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** `from=<username>` when the day was just taken from someone else's. */
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;

  const user = await currentUser();
  if (!user) redirect("/login");

  const entry = await getEntry(id);
  if (!entry || !(await canEditEntry(entry.id, user.id))) notFound();
  const isAuthor = entry.user_id === user.id;
  const coAuthors = isAuthor ? await getCoAuthors(entry.id) : [];
  const accepted = coAuthors.filter((a) => a.status === "accepted");

  const profileListed = await isProfileListed(user.id);

  const { locale, t } = await getDict();
  return (
    <>
      {/* Landing in an editor already full of someone else's words needs
          saying out loud: what was taken, what wasn't, and that nothing is
          published until you save. */}
      {from && (
        <div className="page-container narrow">
          <p className="copied-banner">
            {t.editor.copiedFrom.replace("{user}", from.slice(0, 20))}
          </p>
        </div>
      )}
      <EntryForm
        entry={entry}
        t={t.editor}
        locale={locale}
        profileListed={profileListed}
      />

      {/* Outside the editor's own <form> — a form can't nest — and last on the
          page, so deleting is never a click away from saving. A co-author
          writes the day but cannot end it; leaving is their equivalent, and it
          lives in the tray on their own profile. */}
      {isAuthor && (
        <div className="page-container narrow entry-footer entry-footer-editor">
          <DeleteEntryButton
            id={entry.id}
            labels={{
              delete: t.entry.delete,
              deleting: t.entry.deleting,
              confirm:
                accepted.length > 0
                  ? t.entry.confirmDeleteShared(
                      accepted.map((a) => a.display_name).join(", "),
                      accepted.length
                    )
                  : t.entry.confirmDelete,
            }}
          />
        </div>
      )}
    </>
  );
}
