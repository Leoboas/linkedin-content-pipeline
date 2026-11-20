export const LINKEDIN_POSITIONING = {
  primaryIdentity: ["Python Engineer", "Data Engineer"],
  secondaryIdentity: ["Python Backend Engineer", "Backend Engineer", "Software Engineer", "Data Platform Engineer", "AWS"],
  brazilianTargets: ["Tech Lead", "Lead Data Engineer", "Software Architect", "Senior Python Engineer"],
  internationalTargets: ["Python Engineer", "Python Backend Engineer", "Data Engineer", "Backend Engineer", "Software Engineer", "Data Platform Engineer"],
  prioritySkills: [
    "Python (Programming Language)", "Data Engineering", "SQL", "Amazon Web Services (AWS)", "PostgreSQL", "FastAPI",
    "Apache Airflow", "Extract, Transform, Load (ETL)", "Data Pipelines", "REST APIs", "PySpark", "Databricks", "Docker",
    "Terraform", "CI/CD", "Data Modeling", "Apache Spark", "Redis", "SQLAlchemy", "Software Architecture", "System Design",
    "Distributed Systems", "Cloud Architecture", "Git", "GitHub Actions", "Clean Architecture", "Domain-Driven Design",
    "Technical Leadership", "FinOps",
  ],
  deprioritizedThemes: ["Paid Media", "Growth Marketing", "Ads", "Marketing Automation"],
  contentThemes: ["Python", "Data Engineering", "Backend Engineering", "Software Architecture", "AWS", "System Design", "Cloud", "Databases", "Distributed Systems", "Technical Leadership próxima do código"],
  projectEvidence: ["SerenaERP", "NASA Data Platform", "GitHub", "Databricks Certification"],
  validationMetrics: ["Search appearances", "Categorias profissionais", "Profile views", "Recruiter profile views", "InMails", "Convites para entrevistas", "Tipos de vagas oferecidas"],
  headline: "Python Engineer & Data Engineer | FastAPI, SQL, PostgreSQL, AWS, Airflow & PySpark | Backend, Data Platforms & Software Architecture",
} as const;

export function positioningPrompt(): string {
  return [
    "OBJETIVO DE POSICIONAMENTO:",
    "Apresente o profissional primeiro como engenheiro hands-on e depois como líder técnico.",
    `Identidade primária: ${LINKEDIN_POSITIONING.primaryIdentity.join(" / ")}.`,
    `Identidade secundária: ${LINKEDIN_POSITIONING.secondaryIdentity.join(", ")}.`,
    `Cargos internacionais: ${LINKEDIN_POSITIONING.internationalTargets.join(", ")}.`,
    `Cargos no Brasil: ${LINKEDIN_POSITIONING.brazilianTargets.join(", ")}.`,
    `Skills prioritárias: ${LINKEDIN_POSITIONING.prioritySkills.join(", ")}.`,
    `Temas editoriais: ${LINKEDIN_POSITIONING.contentThemes.join(", ")}.`,
    `Despriorize como identidade principal: ${LINKEDIN_POSITIONING.deprioritizedThemes.join(", ")}.`,
    "Não se autodeclare júnior. Liderança e experiência executiva devem funcionar como prova de senioridade, não como identidade principal.",
    "Não invente experiência, métrica, certificação ou cargo. Diferencie fato comprovado de recomendação.",
  ].join("\n");
}
