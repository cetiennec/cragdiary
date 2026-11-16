"use client";

export type WeatherPoint = { lat: number; lon: number };

// Two forecast sites at the route's own coordinates — no API key, no
// integration, just where to look. Windy for the wind and cloud a climber
// actually plans around; Meteoblue as a second opinion, its week view leans
// less blocky over mountain terrain.
export function weatherLinks({ lat, lon }: WeatherPoint) {
  const hemiLat = lat >= 0 ? "N" : "S";
  const hemiLon = lon >= 0 ? "E" : "W";
  return [
    {
      name: "Windy",
      url: `https://www.windy.com/${lat.toFixed(3)}/${lon.toFixed(3)}?${lat.toFixed(3)},${lon.toFixed(3)},11`,
    },
    {
      name: "Meteoblue",
      url: `https://www.meteoblue.com/en/weather/week/${Math.abs(lat).toFixed(2)}${hemiLat}${Math.abs(lon).toFixed(2)}${hemiLon}`,
    },
    // The Norwegian service's own forecast, from a different blend of models.
    { name: "Yr", url: `https://www.yr.no/en/forecast/daily-table/${lat.toFixed(3)},${lon.toFixed(3)}` },
  ];
}

// A Cragseeker result's own weather, opened the same way its parking is: a
// small disclosure rather than a fetch, since neither site's terms invite
// scraping their forecast into our own page.
export default function WeatherLink({
  point,
  label,
  openIn,
  hint,
  compact,
}: {
  point: WeatherPoint;
  label: string;
  openIn: string;
  hint?: string;
  /** An icon button with the label as its name, for a card's footer. */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <details className="seeker-open-in seeker-icon-menu">
        <summary title={label} aria-label={label}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18Z" />
          </svg>
        </summary>
        <ul>
          {weatherLinks(point).map((link) => (
            <li key={link.name}>
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                {link.name}
              </a>
            </li>
          ))}
        </ul>
      </details>
    );
  }
  return (
    <div className="seeker-weather">
      <span className="seeker-weather-mark" aria-hidden>
        ☁
      </span>
      <span className="seeker-weather-name">{label}</span>
      <details className="seeker-open-in">
        <summary title={hint}>{openIn}</summary>
        <ul>
          {weatherLinks(point).map((link) => (
            <li key={link.name}>
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                {link.name}
              </a>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
