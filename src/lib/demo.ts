// Demo accounts are seeded by scripts/seed-demo-accounts.mjs and are the only
// users whose username carries this prefix — see that script's --remove path,
// which keys off the same rule.
const DEMO_PREFIX = "demo-";

export function isDemoAccount(username: string | null | undefined): boolean {
  return Boolean(username?.startsWith(DEMO_PREFIX));
}
