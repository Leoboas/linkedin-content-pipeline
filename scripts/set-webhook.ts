import { readFile } from "node:fs/promises";

async function loadEnvFile(path: string): Promise<void> {
  try {
    const text = await readFile(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([^#=]+)=(.*)$/.exec(line);
      if (match && process.env[match[1].trim()] === undefined) {
        process.env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, "");
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

await loadEnvFile(".env.local");
await loadEnvFile(".env");

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
if (!token || !secret || !appUrl) {
  throw new Error("TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET e NEXT_PUBLIC_APP_URL sao obrigatorios.");
}

const webhookUrl = `${appUrl}/api/telegram/webhook`;
if (!webhookUrl.startsWith("https://")) {
  throw new Error("NEXT_PUBLIC_APP_URL deve ser uma URL HTTPS oficial da Vercel.");
}

const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ["callback_query", "message"],
  }),
});
const result = (await response.json()) as { ok?: boolean; description?: string };
if (!response.ok || !result.ok) {
  throw new Error(`Telegram setWebhook falhou (${response.status}): ${result.description ?? response.statusText}`);
}

console.log(`Webhook Telegram registrado: ${webhookUrl}`);
