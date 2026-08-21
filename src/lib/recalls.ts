/**
 * Product recalls, from the French government's own register.
 *
 * RappelConso (DGCCRF) publishes every recall declared in France as open data
 * — free, no key, updated weekly — and it does carry climbing gear: the Beal
 * Sunrise 9.2 mm was recalled in October 2025 because one batch failed the
 * number-of-falls requirement of EN 892. That record carries the brand, the
 * model, the batch, the reason and the barcode, which is exactly what a
 * register holds about the same object.
 *
 * The EU's Safety Gate covers the other 30 countries but publishes no API of
 * its own, only weekly reports; if this ever needs to reach past France, that
 * is the next door to knock on.
 *
 * What this file will not do is decide anything. A match here means "the
 * register thinks this may be your gear, go and read the notice" — the batch
 * number on your label is what settles it.
 */

const API =
  "https://data.economie.gouv.fr/api/records/1.0/search/?dataset=rappelconso-v2-gtin-trie";

export type Recall = {
  brand: string;
  models: string;
  reason: string;
  publishedOn: string | null;
  /** Batch numbers and barcodes, as the register printed them. */
  identifiers: string;
  url: string | null;
};

type Row = {
  fields?: {
    marque_produit?: string;
    modeles_ou_references?: string;
    motif_rappel?: string;
    date_publication?: string;
    identification_produits?: string;
    lien_vers_la_fiche_rappel?: string;
    libelle?: string;
  };
};

/**
 * Every recall filed under a brand. One request per brand rather than per
 * item: a register holds a handful of brands and a great many carabiners.
 */
export async function recallsForBrand(brand: string): Promise<Recall[]> {
  const name = brand.trim();
  if (name.length < 2) return [];
  try {
    const res = await fetch(
      `${API}&q=${encodeURIComponent(name)}&rows=20`,
      // A day is fresh enough for a register that is read once a season, and
      // it keeps a page of gear from being twenty requests to Bercy.
      { signal: AbortSignal.timeout(4000), next: { revalidate: 86400 } }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { records?: Row[] };
    return (data.records ?? []).flatMap((r) => {
      const f = r.fields ?? {};
      // The search is full-text over the whole record, so "Camp" matches a
      // camping stove. Keep only what really is this brand.
      if ((f.marque_produit ?? "").toLowerCase() !== name.toLowerCase()) return [];
      return [
        {
          brand: f.marque_produit ?? name,
          models: f.modeles_ou_references ?? f.libelle ?? "",
          reason: f.motif_rappel ?? "",
          publishedOn: f.date_publication?.slice(0, 10) ?? null,
          // The register packs barcode, batch and the rest into one
          // dollar-separated string, padded with empties and with "non
          // concerné" where a field does not apply.
          identifiers: (f.identification_produits ?? "")
            .split("$")
            .map((part) => part.trim())
            .filter((part) => part && part.toLowerCase() !== "non concerné")
            .join(" · "),
          url: f.lien_vers_la_fiche_rappel ?? null,
        },
      ];
    });
  } catch {
    // Bercy being slow is not a reason for a register to fail to open.
    return [];
  }
}

/**
 * The recalls that might be about this item. Deliberately loose on the model —
 * "Sunrise 9.2mm 50m" against a register that says "Sunrise 9.2" should match
 * — and deliberately silent about certainty, because only the batch number on
 * the label can settle it.
 */
export function matchRecalls(
  recalls: Recall[],
  model: string | null
): Recall[] {
  if (recalls.length === 0) return [];
  const words = (model ?? "")
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((w) => w.length > 2);
  if (words.length === 0) return recalls;
  return recalls.filter((r) => {
    const haystack = `${r.models} ${r.brand}`.toLowerCase();
    return words.some((w) => haystack.includes(w));
  });
}
