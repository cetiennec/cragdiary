import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getDict } from "@/lib/i18n";
import ImportTool from "@/components/ImportTool";

export default async function ImportPage() {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }

  const { t } = await getDict();
  return (
    <div className="page-container">
      <h1 className="page-title">{t.importer.title}</h1>
      <ImportTool t={t.importer} />
    </div>
  );
}
