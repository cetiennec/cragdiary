"use client";

import { useRef, useState } from "react";
import { addGear } from "@/app/actions";
import { GEAR_KINDS, searchCatalogue, type GearKind, type GearModel } from "@/lib/gear";

/**
 * Adding a piece of gear. The brand and model come from the catalogue where
 * the catalogue knows them — picking one fills in the kind and the standard
 * too — and from your own typing where it doesn't, since no list will ever
 * hold every sling ever sold.
 */
export default function GearForm({
  t,
  kinds,
}: {
  t: {
    add: string;
    search: string;
    searchHint: string;
    kind: string;
    brand: string;
    model: string;
    serial: string;
    serialHint: string;
    made: string;
    bought: string;
    firstUse: string;
    firstUseHint: string;
    notes: string;
    submit: string;
    cancel: string;
  };
  /** The kind names, localised — the register's own vocabulary. */
  kinds: Record<GearKind, string>;
}) {
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<GearModel[]>([]);
  const [kind, setKind] = useState<GearKind>("rope");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  function pick(hit: GearModel) {
    setKind(hit.kind);
    setBrand(hit.brand);
    setModel(hit.model);
    setHits([]);
  }

  if (!open) {
    return (
      <button type="button" className="btn-primary gear-add" onClick={() => setOpen(true)}>
        + {t.add}
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      action={async (data: FormData) => {
        await addGear(data);
        formRef.current?.reset();
        setOpen(false);
        setBrand("");
        setModel("");
        setHits([]);
      }}
      className="entry-form gear-form"
    >
      {/* The catalogue: two letters is enough to be useful, and nothing here
          is required — the fields below take whatever you type instead. */}
      <label>
        {t.search}
        <span className="combobox">
          <input
            type="search"
            autoComplete="off"
            placeholder={t.searchHint}
            onChange={(e) => setHits(searchCatalogue(e.target.value))}
          />
          {hits.length > 0 && (
            <ul className="combobox-list" role="listbox">
              {hits.map((hit) => (
                <li key={`${hit.brand}-${hit.model}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(hit);
                    }}
                  >
                    <span className="combobox-title">
                      {hit.brand} {hit.model}
                    </span>
                    <span className="combobox-meta">
                      {[kinds[hit.kind], hit.standard].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </span>
      </label>

      <div className="gear-row">
        <label>
          {t.kind}
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as GearKind)}>
            {GEAR_KINDS.map((k) => (
              <option key={k} value={k}>
                {kinds[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.brand}
          <input type="text" name="brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
        </label>
        <label>
          {t.model}
          <input type="text" name="model" value={model} onChange={(e) => setModel(e.target.value)} />
        </label>
      </div>

      <label>
        {t.serial}
        <input type="text" name="serial" placeholder={t.serialHint} autoComplete="off" />
      </label>

      <div className="gear-row">
        <label>
          {t.made}
          <input type="date" name="made_on" />
        </label>
        <label>
          {t.bought}
          <input type="date" name="bought_on" />
        </label>
        <label>
          {t.firstUse}
          <input type="date" name="first_used_on" title={t.firstUseHint} />
        </label>
      </div>
      <p className="form-hint">{t.firstUseHint}</p>

      <label>
        {t.notes}
        <input type="text" name="notes" />
      </label>

      <div className="gear-form-actions">
        <button type="submit" className="btn-primary">
          {t.submit}
        </button>
        <button type="button" className="filter-clear" onClick={() => setOpen(false)}>
          {t.cancel}
        </button>
      </div>
    </form>
  );
}
