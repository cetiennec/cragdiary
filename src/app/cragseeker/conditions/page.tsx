import Link from "next/link";
import { getDict, titled } from "@/lib/i18n";

// How Cragseeker's conditions panel and card labels are worked out. The rules
// themselves live in lib/seeker/weather.ts; this page says them in words, and
// has to change with them.
export const generateMetadata = titled((t) => t.conditions.title);

export default async function ConditionsPage() {
  const { t } = await getDict();
  const c = t.conditions;

  return (
    <div className="page-container narrow credits-page conditions-page">
      <h1 className="page-title">{c.title}</h1>
      <p className="credits-intro">{c.intro}</p>

      {c.sections.map((section) => (
        <section key={section.name}>
          <h2>{section.name}</h2>
          <p>{section.text}</p>
        </section>
      ))}

      <div className="conditions-scroll">
        <table className="conditions-table">
          <tbody>
            {c.verdicts.map(([name, rule]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td>{rule}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>{c.facesHead}</h2>
      <p>{c.facesIntro}</p>
      <div className="conditions-scroll">
        <table className="conditions-table">
          <thead>
            <tr>
              {c.columns.map((col) => (
                <th key={col} scope="col">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.faceRows.map(([faces, day, label, why]) => (
              <tr key={`${faces}-${day}`}>
                <td>{faces}</td>
                <td>{day}</td>
                <td>{label}</td>
                <td>{why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>{c.limitsHead}</h2>
      <ul>
        {c.limits.map((limit) => (
          <li key={limit}>{limit}</li>
        ))}
      </ul>
      <p>{c.limitsOutro}</p>

      <p>
        <Link href="/cragseeker">{c.back}</Link>
      </p>
    </div>
  );
}
