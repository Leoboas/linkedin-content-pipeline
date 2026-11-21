export const TARGET_JOB_TITLES = [
  "Python Backend Engineer",
  "Senior Python Engineer",
  "Python Software Engineer",
  "Data Engineer",
  "Senior Data Engineer",
  "Backend Engineer",
  "Software Engineer",
  "Software Architect",
  "Data Platform Engineer",
  "Analytics Engineer",
  "Tech Lead",
] as const;

export const ASSOCIATED_JOB_TITLES = [
  "Python Engineer",
  "Senior Python Developer",
  "FastAPI Developer",
  "Backend Software Engineer",
  "Senior Software Engineer",
  "Lead Data Engineer",
  "AWS Data Engineer",
  "Full Stack Engineer",
] as const;

const allCareerTitles = [...TARGET_JOB_TITLES, ...ASSOCIATED_JOB_TITLES];
const normalizeTitle = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
const titleLookup = new Map(allCareerTitles.map((title) => [normalizeTitle(title), title]));

/** Only explicitly supported engineering roles can become search targets. */
export function normalizeCareerTargetTitles(values: readonly string[]): string[] {
  const result = new Set<string>();
  for (const value of values) {
    const canonical = titleLookup.get(normalizeTitle(value));
    if (canonical) result.add(canonical);
  }
  return [...result];
}

export function getDefaultCareerTargetTitles(): string[] {
  return [...TARGET_JOB_TITLES];
}

export const SEARCH_LOCATIONS = ["Brasil", "United States", "Europe", "Remote"] as const;

export type TargetJobTitle = (typeof TARGET_JOB_TITLES)[number];
export type SearchLocation = (typeof SEARCH_LOCATIONS)[number];

export function isTargetJobTitle(value: string): value is TargetJobTitle {
  return (TARGET_JOB_TITLES as readonly string[]).includes(value);
}
