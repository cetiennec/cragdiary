import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getDict } from "@/lib/i18n";
import ImportTool from "@/components/ImportTool";
import C2cAccountImport from "@/components/C2cAccountImport";

export default async function ImportPage() {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }

  const { locale, t } = await getDict();
  return (
    <div className="page-container">
      <h1 className="page-title">{t.importer.title}</h1>
      <ImportTool t={t.importer} />
      <C2cAccountImport
        locale={locale}
        username={user.username}
        t={{
          c2cAccountTitle: t.importer.c2cAccountTitle,
          c2cAccountHint: t.importer.c2cAccountHint,
          c2cAccountPlaceholder: t.importer.c2cAccountPlaceholder,
          c2cAccountLoad: t.importer.c2cAccountLoad,
          c2cAccountLoading: t.importer.c2cAccountLoading,
          c2cAccountWarning: t.importer.c2cAccountWarning,
          c2cAccountPhotos: t.importer.c2cAccountPhotos,
          c2cAccountSelectAll: t.importer.c2cAccountSelectAll,
          c2cAccountSelectNone: t.importer.c2cAccountSelectNone,
          c2cAccountCount: t.importer.c2cAccountCount,
          c2cAccountImport: t.importer.c2cAccountImport,
          c2cAccountImporting: t.importer.c2cAccountImporting,
          c2cAccountDone: t.importer.c2cAccountDone,
          c2cAccountEmpty: t.importer.c2cAccountEmpty,
          c2cAccountError: t.importer.c2cAccountError,
        }}
      />
    </div>
  );
}
