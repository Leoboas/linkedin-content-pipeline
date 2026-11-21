export const NETWORKING_ROLE_TARGETS = [
  "Data Engineer", "Senior Software Engineer", "Python Backend Engineer", "Staff Engineer",
  "Principal Engineer", "Software Architect", "Tech Lead", "Engineering Manager",
  "Hiring Manager", "Technical Recruiter",
] as const;

export const NETWORKING_MARKETS = [
  { key: "BR", label: "Brasil", query: "Brazil OR Brasil" },
  { key: "US", label: "Estados Unidos", query: '"United States" OR USA OR remote' },
  { key: "EU", label: "Europa", query: "Europe OR European Union OR remote" },
  { key: "GLOBAL_BR", label: "Empresas internacionais que contratam no Brasil", query: '"Brazil remote" OR "LATAM remote"' },
] as const;

export const DEFAULT_NETWORKING_TOPICS = [
  { key: "python", label: "Python", keywords: ["python", "cpython", "asyncio"] },
  { key: "fastapi", label: "FastAPI", keywords: ["fastapi", "pydantic", "asgi"] },
  { key: "data-engineering", label: "Data Engineering", keywords: ["data engineering", "data engineer", "data platform"] },
  { key: "sql-postgres", label: "SQL & PostgreSQL", keywords: ["sql", "postgres", "postgresql", "query plan"] },
  { key: "aws-cloud", label: "AWS & Cloud Architecture", keywords: ["aws", "amazon web services", "cloud architecture"] },
  { key: "spark-airflow", label: "PySpark & Airflow", keywords: ["pyspark", "spark", "airflow", "orchestration"] },
  { key: "etl-data-quality", label: "ETL/ELT & Data Quality", keywords: ["etl", "elt", "data quality", "data freshness"] },
  { key: "distributed-systems", label: "Distributed Systems", keywords: ["distributed systems", "idempotency", "message queue", "event driven"] },
  { key: "architecture-system-design", label: "Software Architecture & System Design", keywords: ["software architecture", "system design", "clean architecture", "ddd"] },
  { key: "observability-reliability", label: "Observability & Reliability", keywords: ["observability", "reliability", "sre", "incident response"] },
  { key: "technical-leadership", label: "Technical Leadership", keywords: ["technical leadership", "engineering manager", "tech lead", "staff engineer"] },
] as const;

export const DAILY_NETWORKING_STEPS = [
  { key: "discover", label: "Encontrar e ler discussões relevantes", minutes: 7 },
  { key: "comment", label: "Preparar e publicar manualmente 1–2 comentários substantivos", minutes: 7 },
  { key: "respond", label: "Responder manualmente a interações recebidas", minutes: 3 },
  { key: "network", label: "Avaliar conexões com profissionais, recrutadores ou gestores", minutes: 3 },
] as const;

export const NETWORKING_APPROACHES = [
  "TECHNICAL_INSIGHT", "TRADE_OFF", "PRACTICAL_EXAMPLE", "TECHNICAL_QUESTION", "CONSTRUCTIVE_COUNTERPOINT",
] as const;

export const NETWORKING_ACTIVITY_TYPES = [
  "DISCUSSION_REVIEWED", "COMMENT_PREPARED", "COMMENT_PUBLISHED", "REPLY_RECEIVED",
  "RELEVANT_CONNECTION", "PROFESSIONAL_CONVERSATION",
] as const;
