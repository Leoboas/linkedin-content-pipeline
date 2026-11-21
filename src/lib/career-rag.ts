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
}): { score: number; label: string; matchedSkills: string[]; skillGaps: string[]; rationale: string; scoreVersion: string; scoreBreakdown: { technicalSkills: number; roleAlignment: number; responsibilityEvidence: number; seniorityAlignment: number; evidenceConfidence: number } } {
  const scoreVersion = "career-match-v2";
  const jobText = `${input.jobTitle} ${input.jobDescription}`;
  const canonicalProfileSkills = normalizeSkills(input.profileSkills);
  const canonicalJobSkills = extractSkillsFromText(jobText);
  const profileSkillSet = new Set(canonicalProfileSkills);
  const canonicalMatches = canonicalJobSkills.filter((skill) => profileSkillSet.has(skill));
  const matchedSkills = [...new Set(canonicalMatches)];
  const skillGaps = [...new Set(canonicalJobSkills.filter((skill) => !profileSkillSet.has(skill)))].slice(0, 8);
  const profileText = `${input.profileContext} ${canonicalProfileSkills.join(" ")}`.toLocaleLowerCase("en-US");
  const roleFamilies = [
    { key: "data", pattern: /data engineer|data engineering|data platform|analytics engineer|etl|elt|pyspark|spark/iu },
    { key: "python-backend", pattern: /python|backend|back-end|fastapi|django|flask/iu },
    { key: "software-architecture", pattern: /software engineer|software architect|system design|distributed systems/iu },
    { key: "technical-leadership", pattern: /tech lead|technical lead|lead engineer/iu },
  ];
  const jobFamilies = roleFamilies.filter((family) => family.pattern.test(input.jobTitle));
  const profileFamilies = roleFamilies.filter((family) => family.pattern.test(profileText));
  const roleAlignment = jobFamilies.length === 0 ? 10 : Math.round(25 * jobFamilies.filter((family) => profileFamilies.some((candidate) => candidate.key === family.key)).length / jobFamilies.length);
  const technicalSkills = canonicalJobSkills.length === 0 ? 0 : Math.round(45 * canonicalMatches.length / Math.min(canonicalJobSkills.length, 10));
  const responsibilityTerms = ["api", "rest", "architecture", "system design", "data pipeline", "etl", "cloud", "aws", "distributed", "microservices", "database", "observability", "automation"];
  const jobDescriptionLower = input.jobDescription.toLocaleLowerCase("en-US");
  const jobResponsibilities = responsibilityTerms.filter((term) => jobDescriptionLower.includes(term));
  const evidencedResponsibilities = jobResponsibilities.filter((term) => input.profileContext.toLocaleLowerCase("en-US").includes(term));
  const responsibilityEvidence = jobResponsibilities.length === 0 ? 7 : Math.round(15 * evidencedResponsibilities.length / jobResponsibilities.length);
  const seniorityPattern = /\b(principal|staff|lead|senior|sr\.?|mid[- ]level|junior|jr\.?)\b/iu;
  const jobSeniority = input.jobTitle.match(seniorityPattern)?.[1]?.toLocaleLowerCase("en-US") ?? null;
  const profileSeniority = input.profileContext.match(seniorityPattern)?.[1]?.toLocaleLowerCase("en-US") ?? null;
  const seniorityAlignment = !jobSeniority ? 5 : !profileSeniority ? 3 : jobSeniority === profileSeniority ? 10 : /principal|staff|lead|senior|sr/.test(profileSeniority) && /mid|junior|jr/.test(jobSeniority) ? 8 : /junior|jr/.test(profileSeniority) && /senior|lead|staff|principal/.test(jobSeniority) ? 2 : 5;
  const evidenceConfidence = Math.min(100, Math.round((input.profileContext.length >= 2_000 ? 55 : input.profileContext.length >= 500 ? 40 : 20) + Math.min(35, canonicalMatches.length * 7)));
  const scoreBreakdown = { technicalSkills, roleAlignment, responsibilityEvidence, seniorityAlignment, evidenceConfidence };
  const score = Math.round(Math.max(0, Math.min(100, technicalSkills + roleAlignment + responsibilityEvidence + seniorityAlignment + Math.round(evidenceConfidence * 0.05))));
  const label = score >= 75 ? "Alto match" : score >= 50 ? "Match moderado" : "Baixo match";
  const rationale = matchedSkills.length > 0
    ? `Aderência baseada em ${matchedSkills.slice(0, 8).join(", ")}. ${skillGaps.length ? `Investigar gaps: ${skillGaps.join(", ")}.` : "Não foram detectados gaps óbvios no título."}`
    : "Poucas competências do perfil aparecem na descrição; revisar antes de investir tempo na candidatura.";
  return { score, label, matchedSkills, skillGaps, rationale, scoreVersion, scoreBreakdown };
}
