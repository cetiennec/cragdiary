"use client";

import { useRef, useState } from "react";
import { addGear } from "@/app/actions";
import { GEAR_KINDS, type GearKind } from "@/lib/gear";

/**
 * Adding a piece of gear: what it is, and the dates that govern it.
 *
 * No catalogue behind the brand and model. There is no public database of
 * climbing PPE to search, and a hand-kept list of our own would be out of date
 * the week after it was written and never hold every sling ever sold — so what
 * you type is what the register knows. The recall check on the page reads the
 * brand and model straight from here.
 */
export default function GearForm({
  t,
  kinds,
}: {
  t: {
    add: string;
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
  const [kind, setKind] = useState<GearKind>("rope");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

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
      }}
      className="entry-form gear-form"
    >
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
