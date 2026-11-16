// The weather at a Cragseeker search point, from Open-Meteo: the last two
// days, the next week, and the rain hour by hour. Open-Meteo is free with no
// key for non-commercial use and asks for a credit, which the panel gives.
// Asked through here rather than from the browser so answers are shared and
// cached, and the page's security policy stays at "our own origin".

import { limitPublicApi } from "@/lib/rate-limit";
import type { Forecast } from "@/lib/seeker/weather";

type OpenMeteo = {
  elevation?: number;
  current?: { time?: string };
  daily?: {
    time: string[];
    precipitation_sum: (number | null)[];
    precipitation_probability_max: (number | null)[];
    temperature_2m_max: (number | null)[];
    temperature_2m_min: (number | null)[];
  };
  hourly?: { time: string[]; precipitation: (number | null)[] };
};

export async function GET(req: Request) {
  const limited = await limitPublicApi("seeker-weather");
  if (limited) return limited;

  const { searchParams: sp } = new URL(req.url);
  const lat = Number(sp.get("lat"));
  const lon = Number(sp.get("lon"));
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    return Response.json({ error: "bad point" }, { status: 400 });
  }

  // Two decimals is about a kilometre: neighbouring searches share an answer.
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}` +
    "&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min" +
    "&hourly=precipitation&current=temperature_2m&past_days=2&forecast_days=7&timezone=auto";

  let data: OpenMeteo | null = null;
  try {
    const res = await fetch(url, {
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) data = (await res.json()) as OpenMeteo;
  } catch {
    data = null;
  }
  if (!data?.daily || !data.hourly || !data.current?.time) {
    return Response.json({ error: "no forecast" }, { status: 502 });
  }

  const n = (xs: (number | null)[]) => xs.map((x) => x ?? 0);
  const body: Forecast = {
    now: data.current.time,
    elevation: data.elevation ?? 0,
    daily: {
      time: data.daily.time,
      rain: n(data.daily.precipitation_sum),
      chance: n(data.daily.precipitation_probability_max),
      high: n(data.daily.temperature_2m_max),
      low: n(data.daily.temperature_2m_min),
    },
    hourly: { time: data.hourly.time, rain: n(data.hourly.precipitation) },
  };
  return Response.json(body, {
    headers: {
      "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600",
    },
  });
}
