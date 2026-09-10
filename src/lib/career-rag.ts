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
  const jobTokens = new Set(tokenize(jobText));
  const canonicalProfileSkills = normalizeSkills(input.profileSkills);
  const canonicalJobSkills = extractSkillsFromText(jobText);
  const canonicalMatches = canonicalProfileSkills.filter((skill) => canonicalJobSkills.includes(skill));
  const skills = canonicalProfileSkills.flatMap(tokenize);
  const uniqueSkills = [...new Set(skills)];
  const tokenMatches = uniqueSkills.filter((skill) => jobTokens.has(skill));
  const matchedSkills = [...new Set([...canonicalMatches, ...tokenMatches])];
  const canonicalGaps = canonicalJobSkills.filter((skill) => !canonicalProfileSkills.includes(skill));
  const tokenGaps = tokenize(input.jobTitle).filter((token) => !uniqueSkills.includes(token) && jobTokens.has(token));
  const skillGaps = [...new Set([...canonicalGaps, ...tokenGaps])].slice(0, 8);
  const titleTokens = tokenize(input.jobTitle);
  const titleMatch = titleTokens.length === 0 ? 0 : titleTokens.filter((token) => uniqueSkills.includes(token)).length / titleTokens.length;
  const comparableSkillCount = canonicalJobSkills.length > 0 ? canonicalProfileSkills.length : uniqueSkills.length;
  const comparableMatches = canonicalJobSkills.length > 0 ? canonicalMatches.length : tokenMatches.length;
  const skillMatch = comparableSkillCount === 0 ? 0 : comparableMatches / Math.min(comparableSkillCount, 12);
  const contextBoost = tokenize(input.profileContext).some((token) => jobTokens.has(token)) ? 0.08 : 0;
  const score = Math.round(Math.min(100, (skillMatch * 62) + (titleMatch * 30) + (contextBoost * 100)));
  const label = score >= 75 ? "Alto match" : score >= 50 ? "Match moderado" : "Baixo match";
  const rationale = matchedSkills.length > 0
    ? `Aderência baseada em ${matchedSkills.slice(0, 8).join(", ")}. ${skillGaps.length ? `Investigar gaps: ${skillGaps.join(", ")}.` : "Não foram detectados gaps óbvios no título."}`
    : "Poucas competências do perfil aparecem na descrição; revisar antes de investir tempo na candidatura.";
  return { score, label, matchedSkills, skillGaps, rationale };
}
