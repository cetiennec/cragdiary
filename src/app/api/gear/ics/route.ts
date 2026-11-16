import { currentUser } from "@/lib/auth";
import { getGear } from "@/lib/queries";
import { getDict } from "@/lib/i18n";
import { gearName, gearStatus, type GearKind } from "@/lib/gear";

// The register's due dates as a calendar file: each next inspection and each
// usual limit, an all-day event with a reminder a week before. Imported once
// into any calendar; downloaded again after the register changes.
function esc(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

const day = (iso: string) => iso.replace(/-/g, "");
const nextDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
};

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const [{ items, checks }, { t }] = await Promise.all([getGear(user.id), getDict()]);
  const g = t.gear;
  const kinds = g.kinds as Record<GearKind, string>;
  const today = new Date().toISOString().slice(0, 10);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const page = new URL(`/u/${user.username}/gear`, req.url).toString();

  const events: string[] = [];
  const add = (uid: string, on: string, summary: string) => {
    events.push(
      [
        "BEGIN:VEVENT",
        `UID:${uid}@cragdiary`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${day(on)}`,
        `DTEND;VALUE=DATE:${nextDay(on)}`,
        `SUMMARY:${esc(summary)}`,
        `URL:${page}`,
        "BEGIN:VALARM",
        "TRIGGER:-P7D",
        "ACTION:DISPLAY",
        `DESCRIPTION:${esc(summary)}`,
        "END:VALARM",
        "END:VEVENT",
      ].join("\r\n")
    );
  };
  for (const item of items) {
    if (item.retired_on) continue;
    const s = gearStatus(item, checks.get(item.id) ?? [], today);
    const name = [gearName(item, kinds), item.serial].filter(Boolean).join(" ");
    if (s.checkDueOn) add(`check-${item.id}-${s.checkDueOn}`, s.checkDueOn, g.icsCheck.replace("{name}", name));
    if (s.endsOn) add(`end-${item.id}`, s.endsOn, g.icsEnd.replace("{name}", name));
  }

  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Cragdiary//Gear register//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${esc(g.title)}`,
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
  return new Response(body + "\r\n", {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="cragdiary-gear.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
