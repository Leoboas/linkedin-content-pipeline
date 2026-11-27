export const productionExpectedAppliedMigrations = [
  "20261116120000_phase1_knowledge_base_baseline",
  "20261117090000_editorial_calendar_metadata",
  "20261117130000_post_versions",
  "20261117150000_creative_brief_versions",
  "20261118100000_editorial_language_distribution",
  "20261119120000_persist_creative_evidence_media_approval",
  "20261119130000_exact_editorial_language_counts",
  "20261120100000_analytics_snapshots",
  "20261120150000_job_application_crm",
  "20261121100000_linkedin_api_budget",
  "20261121110000_align_persisted_constraint_names",
  "20261121120000_extend_career_search_run_status",
  "20261121130000_career_intelligence_sources_and_resume_library",
  "20261121170000_editorial_calendar_baseline",
  "20261121180000_analytics_import_batches",
  "20261122120000_expand_international_career_sources",
  "20261122140000_version_job_match_score",
  "20261122150000_networking_intelligence",
  "20261122160000_experimental_editorial_career_outcomes",
  "20261123100000_application_queue_and_kits",
] as const;

export const productionExpectedPendingMigrations = [
  "20261124190000_application_submission_authorization",
  "20261127110000_browser_application_executor",
  "20261127111500_browser_executor_index_name",
] as const;

export const productionExpectedIntermediateMigrations = [
  ...productionExpectedAppliedMigrations,
  "20261124190000_application_submission_authorization",
] as const;

export const productionExpectedPostApplyMigrations = [
  ...productionExpectedAppliedMigrations,
  ...productionExpectedPendingMigrations,
] as const;

const RECOVERY_MAX_AGE_MS = 30 * 60 * 1000;

export function assertProductionMigrationAcknowledgements(
  args: readonly string[],
  options: { applying: boolean; now?: Date },
): { recoveryReference: string; recoveryVerifiedAt: string } | null {
  if (!args.includes("--confirm-target=pipeline-db/main")) {
    throw new Error("Falta --confirm-target=pipeline-db/main; nenhuma conexão de escrita será aberta.");
  }
  if (!options.applying) return null;

  const reference = args.find((arg) => arg.startsWith("--recovery-reference="))?.slice("--recovery-reference=".length).trim();
  const verifiedAtRaw = args.find((arg) => arg.startsWith("--recovery-verified-at="))?.slice("--recovery-verified-at=".length).trim();
  if (!reference || !verifiedAtRaw) {
    throw new Error("Para --apply, confirme um ponto de recuperação atual com --recovery-reference=<PITR/snapshot> e --recovery-verified-at=<ISO-8601 UTC>. A branch antiga de novembro não é aceita.");
  }
  if (reference.length > 200 || /[\r\n]/u.test(reference)) throw new Error("Referência de recuperação inválida.");
  const verifiedAt = new Date(verifiedAtRaw);
  const age = (options.now ?? new Date()).getTime() - verifiedAt.getTime();
  if (!Number.isFinite(verifiedAt.getTime()) || age < 0 || age > RECOVERY_MAX_AGE_MS) {
    throw new Error("A verificação do ponto de recuperação deve ser UTC, não futura e ter no máximo 30 minutos.");
  }
  return { recoveryReference: reference, recoveryVerifiedAt: verifiedAt.toISOString() };
}
