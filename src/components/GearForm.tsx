"use client";

import { useRef, useState } from "react";
import { addGear, deleteGear, updateGear } from "@/app/actions";
import { GEAR_KINDS, type GearItem, type GearKind } from "@/lib/gear";

/**
 * Adding a piece of gear: what it is, and the dates that govern it.
 *
 * No catalogue behind the brand and model. There is no public database of
 * climbing PPE to search, and a hand-kept list of our own would be out of date
 * the week after it was written and never hold every sling ever sold — so what
 * you type is what the register knows. The recall check on the page reads the
 * brand and model straight from here.
 *
 * With `item`, the same form corrects an existing piece, and offers to delete
 * it — for a line added by mistake; retiring is what keeps a record.
 */
export default function GearForm({
  t,
  kinds,
  item,
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
    quantity: string;
    quantityHint: string;
    edit: string;
    save: string;
    remove: string;
    removeConfirm: string;
  };
  item?: GearItem;
  /** The kind names, localised — the register's own vocabulary. */
  kinds: Record<GearKind, string>;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<GearKind>(item?.kind ?? "rope");
  const [brand, setBrand] = useState(item?.brand ?? "");
  const [model, setModel] = useState(item?.model ?? "");
  const formRef = useRef<HTMLFormElement>(null);

  if (!open) {
    return (
      <button
        type="button"
        className={item ? "filter-clear gear-edit" : "btn-primary gear-add"}
        onClick={() => setOpen(true)}
      >
        {item ? t.edit : `+ ${t.add}`}
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      action={async (data: FormData) => {
        if (item) {
          await updateGear(data);
          setOpen(false);
          return;
        }
        await addGear(data);
        formRef.current?.reset();
        setOpen(false);
        setBrand("");
        setModel("");
      }}
      className="entry-form gear-form"
    >
      {item && <input type="hidden" name="id" value={item.id} />}
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

      <div className="gear-row">
        <label>
          {t.serial}
          <input
            type="text"
            name="serial"
            placeholder={t.serialHint}
            autoComplete="off"
            defaultValue={item?.serial ?? ""}
          />
        </label>
        {!item && (
          <label className="gear-quantity" title={t.quantityHint}>
            {t.quantity}
            <input type="number" name="quantity" min={1} max={30} defaultValue={1} />
          </label>
        )}
      </div>

      <div className="gear-row">
        <label>
          {t.made}
          <input type="date" name="made_on" defaultValue={item?.made_on ?? ""} />
        </label>
        <label>
          {t.bought}
          <input type="date" name="bought_on" defaultValue={item?.bought_on ?? ""} />
        </label>
        <label>
          {t.firstUse}
          <input
            type="date"
            name="first_used_on"
            title={t.firstUseHint}
            defaultValue={item?.first_used_on ?? ""}
          />
        </label>
      </div>
      <p className="form-hint">{t.firstUseHint}</p>

      <label>
        {t.notes}
        <input type="text" name="notes" defaultValue={item?.notes ?? ""} />
      </label>

      <div className="gear-form-actions">
        <button type="submit" className="btn-primary">
          {item ? t.save : t.submit}
        </button>
        <button type="button" className="filter-clear" onClick={() => setOpen(false)}>
          {t.cancel}
        </button>
        {item && (
          <button
            type="submit"
            formAction={deleteGear}
            className="filter-clear gear-delete"
            onClick={(e) => {
              if (!window.confirm(t.removeConfirm)) e.preventDefault();
            }}
          >
            {t.remove}
          </button>
        )}
      </div>
    </form>
  );
}
