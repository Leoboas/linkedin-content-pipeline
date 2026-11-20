import { getToken, type ConnectTokenSubject } from "@vercel/connect";

const NEON_CONNECTOR = "neon/linkedin-content-pipeline";

/**
 * Obtém um token curto da conexão Neon configurada no Vercel Connect.
 * O token nunca deve ser persistido, logado ou enviado ao cliente.
 */
export async function getNeonConnectToken(
  subject: ConnectTokenSubject = { type: "app" },
): Promise<string> {
  const vercelToken = process.env.VERCEL_ACCESS_TOKEN;
  return getToken(
    NEON_CONNECTOR,
    { subject },
    vercelToken ? { vercelToken } : undefined,
  );
}
