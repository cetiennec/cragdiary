import { getDict } from "@/lib/i18n";

export default async function CreditsPage() {
  const { t } = await getDict();

  return (
    <div className="page-container narrow credits-page">
      <h1 className="page-title">{t.credits.title}</h1>
      <p className="credits-intro">{t.credits.intro}</p>
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
