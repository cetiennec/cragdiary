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
  syncing: string;
  syncNothing: string;
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
    } catch {
      setError(true);
    } finally {
      setChecking(false);
    }
  }

  async function run(choice: { visibility: Visibility; withPhotos: boolean }) {
    if (!missing || missing.length === 0 || importing) return;
    setAsking(false);
    setError(false);
    setProgress({ done: 0, total: missing.length });
    let ok = 0;
    await runPool(missing, IMPORT_CONCURRENCY, async (outing) => {
      try {
        const r = await importOneC2cOuting(outing.id, choice.withPhotos, choice.visibility, {
          revalidate: false,
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
      <button type="button" className="c2c-sync-btn" onClick={() => void check()} disabled={checking || importing}>
        {checking ? t.syncing : `⟳ ${t.sync}`}
      </button>

      {error && <span className="form-error c2c-sync-note">{t.syncError}</span>}
      {imported != null && imported > 0 && (
        <span className="c2c-sync-note">{fill(t.syncDone, imported)}</span>
      )}
      {missing?.length === 0 && <span className="c2c-sync-note">{t.syncNothing}</span>}

      {missing && missing.length > 0 && (
        <div className="c2c-sync-panel">
          <span className="c2c-sync-note">{fill(t.syncFound, missing.length)}</span>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setAsking(true)}
            disabled={importing}
          >
            {importing
              ? `${t.syncImporting} ${progress!.done}/${progress!.total}…`
              : `${t.syncImport} (${missing.length})`}
          </button>
        </div>
      )}

      {asking && missing && (
        <ImportOptionsDialog
          count={missing.length}
          t={t.options}
          onCancel={() => setAsking(false)}
          onConfirm={(choice) => void run(choice)}
        />
      )}
    </div>
  );
}
