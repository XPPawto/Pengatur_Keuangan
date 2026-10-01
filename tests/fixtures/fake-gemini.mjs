#!/usr/bin/env node
// Pengganti `gemini -p "" -o json` untuk tes: melaporkan apa yang diterimanya.
import fs from "node:fs";
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  if (input.includes("MODE:kuota")) {
    process.stderr.write(JSON.stringify({ error: { type: "Error", message: "RESOURCE_EXHAUSTED: quota exceeded", code: 429 } }));
    process.exit(1);
  }
  const settings = JSON.parse(fs.readFileSync(`${process.env.HOME}/.gemini/settings.json`, "utf8"));
  process.stdout.write(
    JSON.stringify({
      session_id: "x",
      response: JSON.stringify({
        args: process.argv.slice(2),
        home: process.env.HOME,
        sistem: fs.readFileSync(process.env.GEMINI_SYSTEM_MD, "utf8"),
        apiKey: process.env.GEMINI_API_KEY ?? null,
        anthropic: process.env.ANTHROPIC_API_KEY ?? null,
        trust: process.env.GEMINI_CLI_TRUST_WORKSPACE,
        tools: settings.tools,
        auth: settings.security.auth.selectedType,
        prompt: input,
      }),
      stats: { models: { "gemini-2.5-flash": { tokens: { prompt: 120, candidates: 30, total: 150 } } } },
    }),
  );
});
