/** Dijalankan Next.js sekali saat server web mulai. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { kunciBerkas } = await import("./lib/keamanan/berkas");
    for (const p of kunciBerkas()) console.warn(`[keamanan] ${p}`);
  }
}
