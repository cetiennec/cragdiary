import { currentUser } from "@/lib/auth";
import { getGear } from "@/lib/queries";
import { getDict } from "@/lib/i18n";
import { gearStatus, type GearKind } from "@/lib/gear";

// The register as a spreadsheet: for a club's inspection, or a guide doing the
// yearly check. One row per item, its last inspection beside it.
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET() {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const [{ items, checks }, { t }] = await Promise.all([getGear(user.id), getDict()]);
  const g = t.gear;
  const kinds = g.kinds as Record<GearKind, string>;
  const today = new Date().toISOString().slice(0, 10);

  const header = [
    g.kind, g.brand, g.model, g.serial, g.made, g.bought, g.firstUse,
    "state", "usual_limit", "next_inspection", "last_inspection", "last_verdict",
    "last_inspector", "last_note", "retired_on", "retired_reason", g.notes,
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const item of items) {
    const history = checks.get(item.id) ?? [];
    const s = gearStatus(item, history, today);
    const last = history[0];
    lines.push(
      [
        kinds[item.kind], item.brand, item.model, item.serial, item.made_on, item.bought_on,
        item.first_used_on, g.states[s.state], s.endsOn, item.retired_on ? null : s.checkDueOn,
        last?.checked_on, last ? g.verdicts[last.verdict] : null, last?.inspector, last?.notes,
        item.retired_on, item.retired_reason, item.notes,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  // BOM so Excel reads the accents.
  return new Response("\uFEFF" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cragdiary-gear-${user.username}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
