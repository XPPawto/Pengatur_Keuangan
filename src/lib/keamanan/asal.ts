/**
 * Tolak permintaan yang mengubah data dari situs lain (CSRF). Server action Next.js sudah punya cek ini;
 * route handler POST harus memanggilnya sendiri.
 */
export function asalSama(req: Request): boolean {
  const asal = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!asal || !host) return false;
  try {
    return new URL(asal).host === host;
  } catch {
    return false;
  }
}
