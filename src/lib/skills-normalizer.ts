import catalog from "../../data/linkedin-skills.json";

type SkillCatalog = { skills: Record<string, string[]> };

const skillCatalog = catalog as SkillCatalog;

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[()]/g, " ")
    .replace(/[\u2013\u2014/|]/g, " ")
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const aliasEntries = Object.entries(skillCatalog.skills).flatMap(([canonical, aliases]) => [
  [canonical, canonical] as const,
  ...aliases.map((alias) => [alias, canonical] as const),
]);

const aliasMap = new Map(aliasEntries.map(([alias, canonical]) => [fold(alias), canonical]));

function containsAlias(text: string, alias: string): boolean {
  if (alias.length <= 3) return new RegExp(`(^|\\s)${alias.replace(/[+.#]/g, "\\$&")}(?=\\s|$)`, "i").test(text);
  return text.includes(alias);
}

function recoverMalformedCanonical(raw: string): string | null {
  const value = fold(raw);
  if (/extract.*transform.*load.*etl/.test(value)) return "Extract, Transform, Load (ETL)";
  if (/extract.*load.*transform.*elt/.test(value)) return "Extract, Load, Transform (ELT)";
  return null;
}

/**
 * Maps user/job variations to the canonical labels used by LinkedIn search.
 * Unknown skills are preserved in trimmed form so the normalizer never loses
 * a legitimate skill that is not yet present in the local catalog.
 */
export function normalizeSkills(skills: string[]): string[] {
  const normalized: string[] = [];
  for (const rawSkill of skills) {
    const raw = rawSkill.trim();
    if (!raw) continue;
    const key = fold(raw);
    if (/^(extract|transform|load)$/.test(key)) continue;
    const recovered = recoverMalformedCanonical(raw);
    if (recovered) {
      if (!normalized.includes(recovered)) normalized.push(recovered);
      continue;
    }
    const direct = aliasMap.get(key);
    const matches = direct
      ? [direct]
      : [...aliasMap.entries()]
        .filter(([alias]) => containsAlias(key, alias))
        .sort(([left], [right]) => right.length - left.length)
        .map(([, canonical]) => canonical);
    for (const skill of matches.length > 0 ? matches : [raw]) {
      if (!normalized.includes(skill)) normalized.push(skill);
    }
  }
  return normalized;
}

/** Extracts all known canonical skills mentioned in free-form job/profile text. */
export function extractSkillsFromText(text: string): string[] {
  return normalizeSkills([text]).filter((skill) => skillCatalog.skills[skill] !== undefined);
}

export function canonicalSkillNames(): string[] {
  return Object.keys(skillCatalog.skills);
}
