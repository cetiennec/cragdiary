import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getDict } from "@/lib/i18n";
import EntryForm from "@/components/EntryForm";

export default async function NewEntryPage() {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }

  const { locale, t } = await getDict();
  return <EntryForm t={t.editor} locale={locale} />;
}
