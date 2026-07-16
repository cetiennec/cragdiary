import { PIN_LABELS, getDict } from "@/lib/i18n";

export default async function CreditsPage() {
  const { locale, t } = await getDict();

  return (
    <div className="page-container narrow credits-page">
      <h1 className="page-title">{t.credits.title}</h1>
      <p className="credits-intro">{t.credits.intro}</p>
      <h2 className="pitch-notes-title">{t.credits.pinsTitle}</h2>
      <ul className="pins-legend">
        {Object.entries(PIN_LABELS[locale]).map(([emoji, label]) => (
          <li key={emoji}>
            <span className="pins-legend-emoji">{emoji}</span> {label}
          </li>
        ))}
      </ul>
      <ul className="credits-list">
        {t.credits.items.map((item) => (
          <li key={item.name}>
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              {item.name}
            </a>
            <p>{item.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
