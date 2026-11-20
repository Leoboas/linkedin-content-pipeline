import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const required = ["LINKEDIN_ACCESS_TOKEN", "LINKEDIN_PERSON_URN"] as const;
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length) {
  console.log("OAuth audit não executada; configure estas variáveis localmente (nenhum valor será exibido):", missing.join(", "));
  process.exit(0);
}

const token = process.env.LINKEDIN_ACCESS_TOKEN!;
const personUrn = process.env.LINKEDIN_PERSON_URN!;
const canIntrospect = Boolean(process.env.LINKEDIN_CLIENT_ID?.trim() && process.env.LINKEDIN_CLIENT_SECRET?.trim());
type TokenIntrospection = { active?: boolean; status?: string; expires_at?: number; scope?: string; client_id?: string };

async function main(): Promise<void> {
try {
  let introspection: TokenIntrospection | null = null;
  if (canIntrospect) {
    const body = new URLSearchParams({ client_id: process.env.LINKEDIN_CLIENT_ID!, client_secret: process.env.LINKEDIN_CLIENT_SECRET!, token });
    const response = await fetch("https://www.linkedin.com/oauth/v2/introspectToken", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, cache: "no-store" });
    if (!response.ok) throw new Error(`Token introspection returned HTTP ${response.status}`);
    introspection = await response.json() as TokenIntrospection;
  }
  const profileResponse = await fetch("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  let memberMatches = false;
  if (profileResponse.ok) {
    const profile = await profileResponse.json() as { sub?: string };
    const configuredId = personUrn.replace(/^urn:li:person:/u, "");
    memberMatches = Boolean(profile.sub && configuredId === profile.sub);
  }
  const scopes = new Set((introspection?.scope ?? "").split(/[ ,]+/u).filter(Boolean));
  console.log(JSON.stringify({
    tokenValidForUserInfo: profileResponse.ok,
    userInfoStatus: profileResponse.status,
    configuredMemberMatchesTokenSubject: memberMatches,
    introspectionPerformed: introspection !== null,
    active: introspection ? introspection.active === true : null,
    status: introspection?.status ?? null,
    expiresAt: introspection?.expires_at ? new Date(introspection.expires_at * 1000).toISOString() : null,
    clientMatchesConfiguredApp: introspection ? introspection.client_id === process.env.LINKEDIN_CLIENT_ID : null,
    grantedAnalyticsScopes: introspection ? {
      r_member_postAnalytics: scopes.has("r_member_postAnalytics"),
      r_member_profileAnalytics: scopes.has("r_member_profileAnalytics"),
    } : null,
    introspectionMissing: canIntrospect ? [] : ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
    note: "UserInfo valida identidade OpenID, não permissões de analytics. Produtos habilitados na aplicação devem ser confirmados no Developer Portal.",
  }, null, 2));
  if (!profileResponse.ok || (introspection && (!introspection.active || introspection.client_id !== process.env.LINKEDIN_CLIENT_ID))) process.exitCode = 1;
} catch (error) {
  console.error("Falha na auditoria OAuth; resposta/token omitidos:", error instanceof Error ? error.message : "erro desconhecido");
  process.exitCode = 1;
}
}

void main();
