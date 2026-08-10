import { notFound, redirect } from "next/navigation";
import { getEntry } from "@/lib/queries";
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
  if (!entry || entry.user_id !== user.id) notFound();

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
      <EntryForm entry={entry} t={t.editor} locale={locale} />

      {/* Outside the editor's own <form> — a form can't nest — and last on the
          page, so deleting is never a click away from saving. */}
      <div className="page-container narrow entry-footer entry-footer-editor">
        <DeleteEntryButton
          id={entry.id}
          labels={{
            delete: t.entry.delete,
            deleting: t.entry.deleting,
            confirm: t.entry.confirmDelete,
          }}
        />
      </div>
    </>
  );
}
