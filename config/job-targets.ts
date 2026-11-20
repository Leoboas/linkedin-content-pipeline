export const TARGET_JOB_TITLES = [
  "Python Engineer",
  "Python Backend Engineer",
  "Data Engineer",
  "Backend Engineer",
  "Software Engineer",
  "Data Platform Engineer",
  "Tech Lead",
] as const;

export const SEARCH_LOCATIONS = ["Brasil", "United States", "Europe", "Remote"] as const;

export type TargetJobTitle = (typeof TARGET_JOB_TITLES)[number];
export type SearchLocation = (typeof SEARCH_LOCATIONS)[number];

export function isTargetJobTitle(value: string): value is TargetJobTitle {
  return (TARGET_JOB_TITLES as readonly string[]).includes(value);
}
