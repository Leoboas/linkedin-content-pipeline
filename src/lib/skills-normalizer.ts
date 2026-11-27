import catalog from "../../data/linkedin-skills.json";
import { LINKEDIN_POSITIONING } from "../../config/linkedin-positioning";

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

// Skills prioritárias do posicionamento que podem não existir no catálogo legado.
const positioningAliases = new Map(
  LINKEDIN_POSITIONING.prioritySkills.flatMap((skill) => {
    const aliases = [skill, skill.toLowerCase(), skill.replace(/\s*\([^)]*\)/g, "")];
    return aliases.map((alias) => [fold(alias), skill] as const);
  }),
);

function containsAlias(text: string, alias: string): boolean {
  // Substring matching made "Java" appear inside "JavaScript", which then
  // inflated a match for Java-first positions. Every alias is now matched on
  // normalized word boundaries while preserving multi-word technologies.
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, "i").test(text);
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
    const direct = aliasMap.get(key) ?? positioningAliases.get(key);
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
