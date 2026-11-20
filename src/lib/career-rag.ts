import type { Prisma } from "@prisma/client";
import { extractSkillsFromText, normalizeSkills } from "@/lib/skills-normalizer";

const STOP_WORDS = new Set([
  "para", "com", "uma", "das", "dos", "the", "and", "from", "your", "you", "que", "por", "sobre",
  "como", "mais", "this", "that", "will", "our", "sua", "seu", "uma", "um", "na", "no", "em",
]);

export function tokenize(value: string): string[] {
  return [...new Set(value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9+#.]{2,}/g) ?? [])]
    .filter((token) => !STOP_WORDS.has(token));
}

export function asStringArray(value: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function buildCareerContext(input: {
  profile: { headline: string; about: string; skills: Prisma.JsonValue; targetTitles: Prisma.JsonValue };
  documents: Array<{ title: string; content: string }>;
}): string {
  const skills = asStringArray(input.profile.skills).join(", ");
  const targets = asStringArray(input.profile.targetTitles).join(", ");
  const documents = input.documents.map((document) => `## ${document.title}\n${document.content.slice(0, 3000)}`).join("\n\n");
  return [
    `Headline: ${input.profile.headline}`,
    `Objetivos: ${targets}`,
    `Competências: ${skills}`,
    `Repertório profissional:\n${documents || "Nenhum documento adicional cadastrado."}`,
  ].join("\n\n");
}

export function calculateMatch(input: {
  profileSkills: string[];
  profileContext: string;
  jobTitle: string;
  jobDescription: string;
}): { score: number; label: string; matchedSkills: string[]; skillGaps: string[]; rationale: string } {
  const jobText = `${input.jobTitle} ${input.jobDescription}`;
  const canonicalProfileSkills = normalizeSkills(input.profileSkills);
  const canonicalJobSkills = extractSkillsFromText(jobText);
  const profileSkillSet = new Set(canonicalProfileSkills);
  const canonicalMatches = canonicalJobSkills.filter((skill) => profileSkillSet.has(skill));
  const matchedSkills = [...new Set(canonicalMatches)];
  const skillGaps = [...new Set(canonicalJobSkills.filter((skill) => !profileSkillSet.has(skill)))].slice(0, 8);
  const titleSkills = extractSkillsFromText(input.jobTitle);
  const titleMatch = titleSkills.length === 0 ? 0 : titleSkills.filter((skill) => profileSkillSet.has(skill)).length / titleSkills.length;
  const skillMatch = canonicalJobSkills.length === 0 ? 0 : canonicalMatches.length / Math.min(canonicalJobSkills.length, 12);
  const contextSkills = extractSkillsFromText(input.profileContext);
  const contextBoost = canonicalJobSkills.some((skill) => contextSkills.includes(skill)) ? 0.08 : 0;
  const score = Math.round(Math.min(100, (skillMatch * 62) + (titleMatch * 30) + (contextBoost * 100)));
  const label = score >= 75 ? "Alto match" : score >= 50 ? "Match moderado" : "Baixo match";
  const rationale = matchedSkills.length > 0
    ? `Aderência baseada em ${matchedSkills.slice(0, 8).join(", ")}. ${skillGaps.length ? `Investigar gaps: ${skillGaps.join(", ")}.` : "Não foram detectados gaps óbvios no título."}`
    : "Poucas competências do perfil aparecem na descrição; revisar antes de investir tempo na candidatura.";
  return { score, label, matchedSkills, skillGaps, rationale };
}
