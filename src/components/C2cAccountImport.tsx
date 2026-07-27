"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { importC2cAccount } from "@/app/actions";
import type { Locale } from "@/lib/i18n";

type C2cOutingSummary = { id: number; date: string | null; title: string };

type Labels = {
  c2cAccountTitle: string;
  c2cAccountHint: string;
  c2cAccountPlaceholder: string;
  c2cAccountLoad: string;
  c2cAccountLoading: string;
  c2cAccountWarning: string;
  c2cAccountPhotos: string;
  c2cAccountSelectAll: string;
  c2cAccountSelectNone: string;
  c2cAccountCount: (n: number) => string;
  c2cAccountImport: (n: number) => string;
  c2cAccountEmpty: string;
  c2cAccountError: string;
};

function ImportButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "…" : label}
    </button>
  );
}

export default function C2cAccountImport({
  locale,
  t,
}: {
  locale: Locale;
  t: Labels;
}) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outings, setOutings] = useState<C2cOutingSummary[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  async function load() {
    const value = url.trim();
    if (!value || loading) return;
    setLoading(true);
    setError(null);
    setOutings(null);
    try {
      const res = await fetch(
        `/api/c2c/account?url=${encodeURIComponent(value)}&lang=${locale}`
      );
      if (!res.ok) throw new Error("load");
      const { outings: list } = (await res.json()) as { outings: C2cOutingSummary[] };
      setOutings(list);
      setSelected(new Set(list.map((o) => o.id)));
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
        <form action={importC2cAccount} className="c2c-account-form">
          <div className="c2c-account-toolbar">
            <span>{t.c2cAccountCount(outings.length)}</span>
            <button
              type="button"
              className="link-btn"
              onClick={() => setSelected(new Set(outings.map((o) => o.id)))}
            >
              {t.c2cAccountSelectAll}
            </button>
            <button type="button" className="link-btn" onClick={() => setSelected(new Set())}>
              {t.c2cAccountSelectNone}
            </button>
            <label className="c2c-account-photos">
              <input type="checkbox" name="photos" value="1" defaultChecked /> {t.c2cAccountPhotos}
            </label>
          </div>

          <ul className="c2c-account-list">
            {outings.map((o) => (
              <li key={o.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.has(o.id)}
                    onChange={() => toggle(o.id)}
                  />
                  <span className="c2c-account-date">{o.date ?? "—"}</span>
                  <span className="c2c-account-title">{o.title}</span>
                </label>
              </li>
            ))}
          </ul>

          {[...selected].map((id) => (
            <input key={id} type="hidden" name="outing" value={id} />
          ))}

          <ImportButton label={t.c2cAccountImport(selected.size)} />
        </form>
      )}
    </section>
  );
}
