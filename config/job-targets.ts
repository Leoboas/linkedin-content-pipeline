export const TARGET_JOB_TITLES = [
  "Desenvolvedor Python",
  "Engenheiro de Dados",
  "Cientista de Dados",
  "Tech Lead",
  "Gerente de Marketing",
  "Diretor de Marketing",
  "Diretor de Tecnologia",
] as const;

export const SEARCH_LOCATIONS = ["Brasil", "Remote"] as const;

export type TargetJobTitle = (typeof TARGET_JOB_TITLES)[number];
export type SearchLocation = (typeof SEARCH_LOCATIONS)[number];

export function isTargetJobTitle(value: string): value is TargetJobTitle {
  return (TARGET_JOB_TITLES as readonly string[]).includes(value);
}
