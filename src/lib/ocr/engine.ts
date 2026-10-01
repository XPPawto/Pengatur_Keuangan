import fs from "node:fs";
import path from "node:path";

/**
 * OCR lokal dengan tesseract.js (gratis, tanpa layanan luar). Data bahasa Indonesia & Inggris diambil dari
 * paket npm @tesseract.js-data, jadi tidak perlu internet saat dipakai.
 */
const LANG_DIR = path.resolve(process.env.OCR_LANG_DIR ?? "./data/ocr-lang");

function siapkanBahasa() {
  fs.mkdirSync(LANG_DIR, { recursive: true });
  for (const lang of ["ind", "eng"]) {
    const tujuan = path.join(LANG_DIR, `${lang}.traineddata.gz`);
    if (fs.existsSync(tujuan)) continue;
    const sumber = path.join(process.cwd(), "node_modules", "@tesseract.js-data", lang, "4.0.0_best_int", `${lang}.traineddata.gz`);
    fs.copyFileSync(sumber, tujuan);
  }
}

export async function bacaTeksGambar(gambar: Buffer): Promise<string> {
  siapkanBahasa();
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(["ind", "eng"], 1, { langPath: LANG_DIR, cachePath: LANG_DIR, gzip: true, logger: () => {} });
  try {
    const { data } = await worker.recognize(gambar);
    return data.text ?? "";
  } finally {
    await worker.terminate();
  }
}
