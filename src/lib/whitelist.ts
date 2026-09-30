/** "0851-6354-4535" / "+62 851..." / "6285...@s.whatsapp.net" / "6285...:12@s.whatsapp.net" -> "6285163544535" */
export function normalizePhone(raw: string): string {
  let s = raw.split("@")[0].split(":")[0].replace(/[^\d]/g, "");
  if (s.startsWith("0")) s = `62${s.slice(1)}`;
  else if (s.startsWith("8")) s = `62${s}`;
  return s;
}

export function ownerNumbers(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.OWNER_WA_NUMBERS ?? "")
    .split(",")
    .map((n) => normalizePhone(n.trim()))
    .filter(Boolean);
}

/** Hanya nomor di OWNER_WA_NUMBERS yang boleh ngobrol dengan bot. */
export function isOwner(raw: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const n = normalizePhone(raw);
  return n !== "" && ownerNumbers(env).includes(n);
}
