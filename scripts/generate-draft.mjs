import { readFile } from "node:fs/promises";

async function loadEnvFile(path) {
  try {
    const text = await readFile(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([^#=]+)=(.*)$/.exec(line);
      if (match && process.env[match[1].trim()] === undefined) {
        process.env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, "");
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

await loadEnvFile(".env.local");
await loadEnvFile(".env");

const baseUrl = (process.env.DRAFT_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const cronSecret = process.env.CRON_SECRET;
if (!cronSecret) throw new Error("CRON_SECRET nao configurado.");

const triggeredAt = process.env.DRAFT_TRIGGERED_AT ?? new Date().toISOString();
const response = await fetch(`${baseUrl}/api/cron/weekly?triggeredAt=${encodeURIComponent(triggeredAt)}`, {
  headers: { authorization: `Bearer ${cronSecret}` },
});
const body = await response.text();
if (!response.ok) throw new Error(`Falha ao gerar draft (${response.status}): ${body}`);
console.log(`Draft disparado em ${baseUrl}: ${body}`);
