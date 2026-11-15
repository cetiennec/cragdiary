import { getDict, titled } from "@/lib/i18n";

export const generateMetadata = titled((t) => t.legal.title);

export default async function LegalPage() {
  const { t } = await getDict();

  return (
    <div className="page-container narrow credits-page">
      <h1 className="page-title">{t.legal.title}</h1>
      <p className="credits-intro">{t.legal.intro}</p>
      <ul className="credits-list">
        {t.legal.sections.map((section) => (
          <li key={section.name}>
            <strong>{section.name}</strong>
            <p>{section.text}</p>
            {"url" in section && section.url && (
              <p>
                <a
                  href={section.url}
                  {...(section.url.startsWith("http")
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                >
                  {section.url.replace(/^mailto:/, "")}
                </a>
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
