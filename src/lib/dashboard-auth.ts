export function isDashboardAuthorized(request: Request): boolean {
  const expectedToken = process.env.DASHBOARD_ADMIN_TOKEN;
  if (!expectedToken) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${expectedToken}`;
}
