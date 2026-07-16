import { getDict } from "@/lib/i18n";

export default async function PrivacyPage() {
  const { t } = await getDict();

  return (
    <div className="page-container narrow credits-page">
      <h1 className="page-title">{t.privacy.title}</h1>
      <p className="credits-intro">{t.privacy.intro}</p>
      <ul className="credits-list">
        {t.privacy.sections.map((section) => (
          <li key={section.name}>
            <strong>{section.name}</strong>
            <p>{section.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
