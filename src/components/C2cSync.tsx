"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { importOneC2cOuting, refreshAfterImport } from "@/app/actions";
import { runPool } from "@/lib/pool";
import ImportOptionsDialog, {
  type ImportOptionsLabels,
  type Visibility,
} from "./ImportOptionsDialog";
import type { Locale } from "@/lib/i18n";

// Same reasoning as the bulk import: enough in flight to keep the network busy,
// not enough to hammer camptocamp.
const IMPORT_CONCURRENCY = 4;

type Outing = { id: number; date: string | null; title: string; imported?: boolean };

export type SyncLabels = {
  sync: string;
  /** What fits in the action row; the full label is the tooltip. */
  syncShort: string;
  syncing: string;
  syncNothing: string;
  syncComplete: string;
  syncFound: string; // "{n} outings not in your journal"
  syncImport: string;
  syncImporting: string;
  syncDone: string; // "{n} imported"
  syncError: string;
  options: ImportOptionsLabels;
};

function fill(template: string, value: number): string {
  return template.replace("{n}", String(value));
}

// "Sync with camptocamp": find the outings on the linked account that aren't in
// the journal yet, then import them. Own profile only.
export default function C2cSync({
  profileId,
  locale,
  t,
}: {
  profileId: number;
  locale: Locale;
  t: SyncLabels;
}) {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [missing, setMissing] = useState<Outing[] | null>(null);
  // Days already in the journal: never re-imported, but they can be completed.
  const [existing, setExisting] = useState<Outing[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [imported, setImported] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [asking, setAsking] = useState(false);

  const importing = progress !== null && progress.done < progress.total;

  async function check() {
    if (checking || importing) return;
    setChecking(true);
    setError(false);
    setImported(null);
    setMissing(null);
    try {
      const res = await fetch(`/api/c2c/account?url=${profileId}&lang=${locale}`);
      if (!res.ok) throw new Error("load");
      const { outings } = (await res.json()) as { outings: Outing[] };
      // The endpoint flags what's already in the journal by outing URL, which
      // is what makes syncing twice harmless.
      setMissing(outings.filter((o) => !o.imported));
      setExisting(outings.filter((o) => o.imported));
    } catch {
      setError(true);
    } finally {
      setChecking(false);
    }
  }

  async function run(choice: {
    visibility: Visibility;
    withPhotos: boolean;
    complete: boolean;
  }) {
    if (!missing || importing) return;
    const work = [
      ...missing.map((o) => ({ outing: o, onExisting: "skip" as const })),
      ...(choice.complete
        ? existing.map((o) => ({ outing: o, onExisting: "merge" as const }))
        : []),
    ];
    if (work.length === 0) return;
    setAsking(false);
    setError(false);
    setProgress({ done: 0, total: work.length });
    let ok = 0;
    await runPool(work, IMPORT_CONCURRENCY, async ({ outing, onExisting }) => {
      try {
        const r = await importOneC2cOuting(outing.id, choice.withPhotos, choice.visibility, {
          revalidate: false,
          onExisting,
        });
        if (r?.ok) ok += 1;
      } catch {
        // One failure shouldn't stop the rest.
      }
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    });
    setImported(ok);
    setMissing(null);
    if (ok === 0) {
      setError(true);
      setProgress(null);
      return;
    }
    await refreshAfterImport();
    router.refresh();
  }

  return (
    <div className="c2c-sync">
      {/* Short enough to sit with the round action buttons; hovering says what
          it does. */}
      <button
        type="button"
        className="c2c-sync-btn"
        title={checking ? t.syncing : t.sync}
        aria-label={checking ? t.syncing : t.sync}
        onClick={() => void check()}
        disabled={checking || importing}
      >
        <span aria-hidden>⟳</span> {checking ? "…" : t.syncShort}
      </button>

      {/* Everything it has to say floats under the button: written into the
          row, it shoved the buttons next to it around. */}
      {(error || imported != null || missing !== null) && (
        <div className="c2c-sync-pop">
          {error && <span className="form-error c2c-sync-note">{t.syncError}</span>}
          {imported != null && imported > 0 && (
            <span className="c2c-sync-note">{fill(t.syncDone, imported)}</span>
          )}
          {missing?.length === 0 && existing.length === 0 && (
            <span className="c2c-sync-note">{t.syncNothing}</span>
          )}

          {missing && (missing.length > 0 || existing.length > 0) && (
            <div className="c2c-sync-panel">
              <span className="c2c-sync-note">
                {missing.length > 0 ? fill(t.syncFound, missing.length) : t.syncNothing}
              </span>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setAsking(true)}
                disabled={importing}
              >
                {importing
                  ? `${t.syncImporting} ${progress!.done}/${progress!.total}…`
                  : missing.length > 0
                    ? `${t.syncImport} (${missing.length})`
                    : t.syncComplete}
              </button>
            </div>
          )}
        </div>
      )}

      {asking && missing && (
        <ImportOptionsDialog
          count={missing.length}
          existingCount={existing.length}
          askComplete
          t={t.options}
          onCancel={() => setAsking(false)}
          onConfirm={(choice) => void run(choice)}
        />
      )}
    </div>
  );
}
