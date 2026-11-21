import { fetchLinkedInMemberFollowerCount, fetchLinkedInMemberPostMetrics, type LinkedInMemberMetric } from "@/lib/linkedin";

export type AnalyticsProviderId = "LINKEDIN_API" | "MANUAL" | "CSV_IMPORT" | "XLSX_IMPORT";

export interface OfficialLinkedInAnalyticsProvider {
  id: "LINKEDIN_API";
  apiVersion: string;
  readiness(capability: "post" | "profile"): { enabled: boolean; reason: string | null };
  fetchPostMetrics(postUrn: string): Promise<LinkedInMemberMetric[]>;
  fetchFollowerCount(): Promise<number | null>;
}

export const linkedInOfficialAnalyticsProvider: OfficialLinkedInAnalyticsProvider = {
  id: "LINKEDIN_API",
  apiVersion: process.env.LINKEDIN_VERSION ?? "202606",
  readiness(capability) {
    const featureEnabled = capability === "post" ? process.env.LINKEDIN_POST_ANALYTICS_ENABLED === "true" : process.env.LINKEDIN_PROFILE_ANALYTICS_ENABLED === "true";
    if (!featureEnabled) return { enabled: false, reason: "feature-flag-disabled" };
    if (!process.env.LINKEDIN_ACCESS_TOKEN) return { enabled: false, reason: "missing-token" };
    const permissionFlag = capability === "post" ? "LINKEDIN_POST_ANALYTICS_PERMISSION_CONFIRMED" : "LINKEDIN_PROFILE_ANALYTICS_PERMISSION_CONFIRMED";
    if (process.env[permissionFlag] !== "true") return { enabled: false, reason: "oauth-scope-not-confirmed" };
    return { enabled: true, reason: null };
  },
  fetchPostMetrics: fetchLinkedInMemberPostMetrics,
  fetchFollowerCount: fetchLinkedInMemberFollowerCount,
};

export const MANUAL_ANALYTICS_PROVIDERS = ["MANUAL", "CSV_IMPORT", "XLSX_IMPORT"] as const;
