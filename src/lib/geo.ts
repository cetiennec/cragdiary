const PHOTON_REVERSE = "https://photon.komoot.io/reverse";

// Country (ISO 3166-1 alpha-2) for coordinates, via Photon reverse geocoding.
// Best effort: a slow or down geocoder must never block a save.
export async function lookupCountry(lat: number, lon: number): Promise<string | null> {
  try {
    const res = await fetch(`${PHOTON_REVERSE}?lat=${lat}&lon=${lon}&limit=1`, {
      signal: AbortSignal.timeout(4000),
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      features?: { properties?: { countrycode?: string } }[];
    };
    const cc = data.features?.[0]?.properties?.countrycode;
    return cc ? cc.toUpperCase() : null;
  } catch {
    return null;
  }
}

export function flagEmoji(countryCode: string): string {
  return countryCode
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}
