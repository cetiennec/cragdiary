import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getUserByUsername, getGear, getEntryDates } from "@/lib/queries";
import { getDict } from "@/lib/i18n";
import { recallsForBrand, type Recall } from "@/lib/recalls";
import GearRegister from "./register";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The EPI register — one climber's gear, and what is owed to each piece of it.
 *
 * Yours alone for now: a register is a private document, and the interesting
 * question of who else may read it (a club, a guide doing the annual
 * inspection) is one to answer deliberately rather than by default. Until
 * then the CSV and the printed sheet are how it reaches them.
 */
export default async function GearPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ state?: string; kind?: string }>;
}) {
  const [{ username }, sp] = await Promise.all([params, searchParams]);
  const [profile, user, { t, locale }] = await Promise.all([
    getUserByUsername(username),
    currentUser(),
    getDict(),
  ]);
  if (!profile) notFound();
  if (!user || user.id !== profile.id) notFound();

  const [{ items, checks }, entryDates] = await Promise.all([
    getGear(profile.id),
    getEntryDates(profile.id),
  ]);

  // One request per brand, not per item: a register holds a handful of brands
  // and a great many carabiners. Cached for a day upstream.
  const brands = [...new Set(items.map((i) => i.brand).filter(Boolean) as string[])];
  const recallsByBrand = new Map<string, Recall[]>(
    await Promise.all(
      brands.map(
        async (brand) => [brand.toLowerCase(), await recallsForBrand(brand)] as const
      )
    )
  );

  return (
    <GearRegister
      profile={profile}
      items={items}
      checks={checks}
      entryDates={entryDates}
      recallsByBrand={recallsByBrand}
      sp={sp}
      t={t}
      locale={locale}
    />
  );
}
