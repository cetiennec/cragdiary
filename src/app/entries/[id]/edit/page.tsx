import { notFound, redirect } from "next/navigation";
import { getEntry } from "@/lib/queries";
import { currentUser } from "@/lib/auth";
import { getDict } from "@/lib/i18n";
import EntryForm from "@/components/EntryForm";

export default async function EditEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await currentUser();
  if (!user) redirect("/login");

  const entry = await getEntry(id);
  if (!entry || entry.user_id !== user.id) notFound();

  const { locale, t } = await getDict();
  return <EntryForm entry={entry} t={t.editor} locale={locale} />;
}
