import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getDict } from "@/lib/i18n";
import ImportTool from "@/components/ImportTool";
import C2cAccountImport from "@/components/C2cAccountImport";

// Bulk c2c import (server action per outing) fetches + processes photos, which
// can take a while — allow up to the platform max instead of the ~10s default.
export const maxDuration = 60;

export default async function ImportPage() {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }

  const { locale, t } = await getDict();
  return (
    <div className="page-container">
      <h1 className="page-title">{t.importer.title}</h1>
      <p className="import-intro">{t.importer.intro}</p>
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
          c2cAccountFound: t.importer.c2cAccountFound,
          c2cAccountImportBtn: t.importer.c2cAccountImportBtn,
          c2cAccountImportingLabel: t.importer.c2cAccountImportingLabel,
          c2cAccountDoneLabel: t.importer.c2cAccountDoneLabel,
          c2cAccountEmpty: t.importer.c2cAccountEmpty,
          c2cAccountError: t.importer.c2cAccountError,
          c2cAccountVisibility: t.importer.c2cAccountVisibility,
          visibilityOptions: t.editor.visibilityOptions,
        }}
      />
      <ImportTool t={t.importer} />
    </div>
  );
}
