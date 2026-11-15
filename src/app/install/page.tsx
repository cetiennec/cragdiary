import type { Metadata } from "next";
import { getDict } from "@/lib/i18n";

// "Cragdiary on your phone" names the site already, so no suffix here.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return { title: { absolute: t.install.title } };
}

export default async function InstallPage() {
  const { t } = await getDict();

  return (
    <div className="page-container narrow install-page">
      <h1 className="page-title">{t.install.title}</h1>
      <p className="credits-intro">{t.install.intro}</p>
      <h2 className="pitch-notes-title">{t.install.iosTitle}</h2>
      <ol>
        {t.install.iosSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <h2 className="pitch-notes-title">{t.install.androidTitle}</h2>
      <ol>
        {t.install.androidSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="form-hint">{t.install.note}</p>
    </div>
  );
}
