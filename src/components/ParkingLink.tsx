"use client";

export type ParkingPoint = { lat: number; lon: number; name: string | null };

// Where a parking can be opened. Google and Apple get a directions link so the
// phone starts navigating; Waze and OSM take a plain point.
function mapLinks({ lat, lon, name }: ParkingPoint) {
  const point = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  return [
    { name: "Google Maps", url: `https://www.google.com/maps/dir/?api=1&destination=${point}` },
    {
      name: "Apple Plans",
      url: `https://maps.apple.com/?daddr=${point}&dirflg=d${name ? `&q=${encodeURIComponent(name)}` : ""}`,
    },
    { name: "Waze", url: `https://waze.com/ul?ll=${point}&navigate=yes` },
    {
      name: "OpenStreetMap",
      url: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`,
    },
  ];
}

// The parking camptocamp records as a route's access point — shown on a
// CragSeeker result and carried over to a wishlist when the route is saved.
export default function ParkingLink({
  parking,
  label,
  openIn,
  hint,
}: {
  parking: ParkingPoint;
  label: string;
  openIn: string;
  hint?: string;
}) {
  return (
    <div className="seeker-parking">
      <span className="seeker-parking-mark" aria-hidden>
        P
      </span>
      <span className="seeker-parking-name">{parking.name ?? label}</span>
      {/* <details> keeps this a plain disclosure: no outside-click handling,
          and it closes itself on Escape. */}
      <details className="seeker-open-in">
        <summary title={hint}>{openIn}</summary>
        <ul>
          {mapLinks(parking).map((link) => (
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
