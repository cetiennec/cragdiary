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
            {/* Contact and the supervisory authority have to be reachable, not
                just mentioned — a notice nobody can act on isn't information. */}
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
            {"links" in section && section.links && (
              <p className="privacy-links">
                {section.links.map((link) => (
                  <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">
                    {link.name}
                  </a>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="form-hint">{t.privacy.updated}</p>
    </div>
  );
}
