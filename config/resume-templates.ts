export type ResumeTemplateId = "ats-tech" | "ats-data" | "executive-growth";

export interface ResumeTemplateDefinition {
  id: ResumeTemplateId;
  label: string;
  description: string;
  targetRoles: string[];
  sections: string[];
  rules: string[];
}

export const RESUME_TEMPLATES: ResumeTemplateDefinition[] = [
  {
    id: "ats-tech",
    label: "ATS Tech Lead",
    description: "Currículo de uma coluna para Tech Lead, CTO hands-on e arquitetura de software.",
    targetRoles: ["Tech Lead", "CTO", "Lead Software Engineer", "Engineering Manager"],
    sections: ["summary", "skills", "experience", "projects", "education", "languages"],
    rules: [
      "Priorizar arquitetura, liderança técnica, engenharia de software, cloud, DevOps e entregas mensuráveis.",
      "Usar nomes canônicos de tecnologias e separar competências por domínio.",
      "Não usar tabelas, colunas, ícones, barras de proficiência, emojis ou texto dentro de imagens.",
    ],
  },
  {
    id: "ats-data",
    label: "ATS Data Engineering",
    description: "Currículo orientado a Engenharia de Dados, Analytics e plataformas de dados.",
    targetRoles: ["Engenheiro de Dados", "Lead Data Architect", "Analytics Engineering Manager", "Cientista de Dados"],
    sections: ["summary", "skills", "experience", "selectedProjects", "education", "languages"],
    rules: [
      "Priorizar pipelines ETL/ELT, orquestração, modelagem, observabilidade, governança, cloud e impacto operacional.",
      "Cada experiência deve mostrar contexto, ação técnica e resultado verificável.",
      "Não listar ferramentas sem evidência de uso no histórico ou nos projetos fornecidos.",
    ],
  },
  {
    id: "executive-growth",
    label: "Executivo Tech + Growth",
    description: "Currículo executivo para CTO, liderança de operações, Growth e MarTech.",
    targetRoles: ["CTO", "Head of Technology", "Head of Growth", "Diretor de Tecnologia"],
    sections: ["executiveSummary", "leadershipSkills", "experience", "businessImpact", "education", "languages"],
    rules: [
      "Conectar decisões de tecnologia a receita, retenção, eficiência, risco, valuation e capacidade operacional.",
      "Manter profundidade técnica suficiente para passar por triagem de liderança de tecnologia.",
      "Evitar linguagem genérica de executivo; toda afirmação deve estar apoiada em evidência do perfil.",
    ],
  },
];

export function getResumeTemplate(id: string | undefined): ResumeTemplateDefinition {
  return RESUME_TEMPLATES.find((template) => template.id === id) ?? RESUME_TEMPLATES[0];
}
