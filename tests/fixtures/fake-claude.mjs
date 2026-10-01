#!/usr/bin/env node
// Pengganti `claude -p --output-format json` untuk tes runner. Perilaku diatur lewat isi prompt (stdin).
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const out = (o) => process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5 }, ...o }));
  if (input.includes("MODE:401")) return out({ is_error: true, api_error_status: 401, result: "Failed to authenticate. API Error: 401 Invalid bearer token" });
  if (input.includes("MODE:limit")) return out({ is_error: true, result: "Claude AI usage limit reached|1760000000" });
  if (input.includes("MODE:diam")) return setTimeout(() => {}, 60_000);
  if (input.includes("MODE:rusak")) return process.stdout.write("bukan json");
  out({
    result: JSON.stringify({
      args: process.argv.slice(2),
      token: process.env.CLAUDE_CODE_OAUTH_TOKEN ?? null,
      apiKey: process.env.ANTHROPIC_API_KEY ?? null,
      configDir: process.env.CLAUDE_CONFIG_DIR ?? null,
      panjangPrompt: input.length,
    }),
  });
});
