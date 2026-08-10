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

// Enough to keep the network busy without asking camptocamp for too much at
// once, or running several photo re-encodes side by side in one function.
const IMPORT_CONCURRENCY = 4;

type C2cOutingSummary = {
  id: number;
  date: string | null;
  title: string;
  imported?: boolean;
};

type Labels = {
  c2cAccountTitle: string;
  c2cAccountHint: string;
  c2cAccountPlaceholder: string;
  c2cAccountLoad: string;
  c2cAccountLoading: string;
  c2cAccountWarning: string;
  c2cAccountSelectAll: string;
  c2cAccountSelectNone: string;
  c2cAccountFound: string;
  c2cAccountImportBtn: string;
  c2cAccountImportingLabel: string;
  c2cAccountDoneLabel: string;
  c2cAccountEmpty: string;
  c2cAccountError: string;
  c2cAccountImported: string;
  options: ImportOptionsLabels;
};

export default function C2cAccountImport({
  locale,
  username,
  t,
}: {
  locale: Locale;
  username: string;
  t: Labels;
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outings, setOutings] = useState<C2cOutingSummary[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [asking, setAsking] = useState(false);
  // Import progress: null = idle, else {done,total}. done === total when finished.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const importing = progress !== null && progress.done < progress.total;

  async function load() {
    const value = url.trim();
    if (!value || loading) return;
    setLoading(true);
    setError(null);
    setOutings(null);
    setProgress(null);
    try {
      const res = await fetch(
        `/api/c2c/account?url=${encodeURIComponent(value)}&lang=${locale}`
      );
      if (!res.ok) throw new Error("load");
      const { outings: list } = (await res.json()) as { outings: C2cOutingSummary[] };
      setOutings(list);
      // Pre-select everything except outings already imported (duplicates).
      setSelected(new Set(list.filter((o) => !o.imported).map((o) => o.id)));
    } catch {
      setError(t.c2cAccountError);
    } finally {
      setLoading(false);
    }
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // One outing per request, so each stays short (the serverless time limit) and
  // progress is real — but several in flight, since each spends its time
  // waiting on camptocamp. Entries land in the journal as they arrive.
  async function runImport(choice: {
    visibility: Visibility;
    withPhotos: boolean;
    complete: boolean;
  }) {
    const ids = [...selected];
    if (ids.length === 0 || importing) return;
    setAsking(false);
    setError(null);
    setProgress({ done: 0, total: ids.length });
    let ok = 0;
    await runPool(ids, IMPORT_CONCURRENCY, async (id) => {
      try {
        // The batch revalidates once at the end: revalidating per outing made
        // the browser re-render the whole page after every single one.
        // Ticking a day that's already in the journal means "complete it" —
        // the alternative would be a second copy of the same day.
        const r = await importOneC2cOuting(id, choice.withPhotos, choice.visibility, {
          revalidate: false,
          onExisting: choice.complete ? "merge" : "skip",
        });
        if (r?.ok) ok += 1;
      } catch {
        // Keep going; a single failure shouldn't stop the batch.
      }
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    });
    if (ok === 0) {
      // Nothing imported — surface it instead of navigating to an unchanged page.
      setError(t.c2cAccountError);
      setProgress(null);
      return;
    }
    await refreshAfterImport();
    router.push(`/u/${username}`);
    router.refresh();
  }

  return (
    <section id="c2c-account" className="c2c-account">
      <h2 className="page-subtitle">{t.c2cAccountTitle}</h2>
      <p className="form-hint">{t.c2cAccountHint}</p>

      <div className="c2c-account-load">
        <input
          type="url"
          inputMode="url"
          className="c2c-import-input"
          placeholder={t.c2cAccountPlaceholder}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void load();
            }
          }}
        />
        <button
          type="button"
          className="c2c-import-btn"
          onClick={() => void load()}
          disabled={loading || !url.trim()}
        >
          {loading ? t.c2cAccountLoading : t.c2cAccountLoad}
        </button>
      </div>

      <p className="c2c-import-note">⚠️ {t.c2cAccountWarning}</p>
      {error && <p className="form-error">{error}</p>}

      {outings && outings.length === 0 && <p className="form-hint">{t.c2cAccountEmpty}</p>}

      {outings && outings.length > 0 && (
        <div className="c2c-account-form">
          <div className="c2c-account-toolbar">
            <span>
              {outings.length} {t.c2cAccountFound}
            </span>
            <button
              type="button"
              className="link-btn"
              onClick={() => setSelected(new Set(outings.map((o) => o.id)))}
              disabled={importing}
            >
              {t.c2cAccountSelectAll}
            </button>
            <button
              type="button"
              className="link-btn"
              onClick={() => setSelected(new Set())}
              disabled={importing}
            >
              {t.c2cAccountSelectNone}
            </button>
          </div>

          <ul className="c2c-account-list">
            {outings.map((o) => (
              <li key={o.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.has(o.id)}
                    onChange={() => toggle(o.id)}
                    disabled={importing}
                  />
                  <span className="c2c-account-date">{o.date ?? "—"}</span>
                  <span className="c2c-account-title">{o.title}</span>
                  {o.imported && (
                    <span className="c2c-account-imported">{t.c2cAccountImported}</span>
                  )}
                </label>
              </li>
            ))}
          </ul>

          {progress && progress.done >= progress.total ? (
            <p className="c2c-import-status">
              {progress.total} {t.c2cAccountDoneLabel}
            </p>
          ) : (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setAsking(true)}
              disabled={importing || selected.size === 0}
            >
              {importing
                ? `${t.c2cAccountImportingLabel} ${progress!.done}/${progress!.total}…`
                : `${t.c2cAccountImportBtn} (${selected.size})`}
            </button>
          )}
        </div>
      )}

      {asking && (
        <ImportOptionsDialog
          count={selected.size}
          existingCount={(outings ?? []).filter((o) => o.imported && selected.has(o.id)).length}
          t={t.options}
          onCancel={() => setAsking(false)}
          onConfirm={(choice) => void runImport(choice)}
        />
      )}
    </section>
  );
}
