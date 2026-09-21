import { createHmac, timingSafeEqual } from "node:crypto";

export const DASHBOARD_SESSION_COOKIE = "dashboard_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

function secret(): string {
  return process.env.DASHBOARD_SESSION_SECRET?.trim() || process.env.DASHBOARD_ADMIN_TOKEN?.trim() || "";
}

function signature(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createDashboardSession(username: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${username}:${expiresAt}`;
  return `${Buffer.from(payload).toString("base64url")}.${signature(payload)}`;
}

export function isDashboardSessionValid(value: string | undefined): boolean {
  if (!value || !secret()) return false;
  const [encodedPayload, providedSignature] = value.split(".");
  if (!encodedPayload || !providedSignature) return false;
  try {
    const payload = Buffer.from(encodedPayload, "base64url").toString("utf8");
    const [username, expiresAt] = payload.split(":");
    if (!username || !Number.isFinite(Number(expiresAt)) || Number(expiresAt) < Math.floor(Date.now() / 1000)) return false;
    return safeEqual(signature(payload), providedSignature);
  } catch {
    return false;
  }
}

export function dashboardCredentialsMatch(username: string, password: string): boolean {
  const expectedUsername = process.env.DASHBOARD_ADMIN_USERNAME?.trim();
  const expectedPassword = process.env.DASHBOARD_ADMIN_PASSWORD;
  if (!expectedUsername || !expectedPassword || !secret()) return false;
  return safeEqual(username, expectedUsername) && safeEqual(password, expectedPassword);
}

function cookieValue(request: Request): string | undefined {
  const cookieHeader = request.headers.get("cookie") ?? "";
  return cookieHeader.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${DASHBOARD_SESSION_COOKIE}=`))?.slice(DASHBOARD_SESSION_COOKIE.length + 1);
}

export function isDashboardAuthorized(request: Request): boolean {
  if (isDashboardSessionValid(cookieValue(request))) return true;
  const expectedToken = process.env.DASHBOARD_ADMIN_TOKEN;
  if (!expectedToken) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${expectedToken}`;
}
