export function authorizedResumeStorageKey(baseKey: string, sha256: string, canonicalAlreadyExists: boolean): string {
  if (!/^[a-f0-9]{64}$/iu.test(sha256)) throw new Error("SHA-256 de currículo inválido.");
  return canonicalAlreadyExists ? `${baseKey}-v${sha256.slice(0, 12).toLowerCase()}` : baseKey;
}

export function authorizedResumeVersion(baseVersion: string, sha256: string, canonicalAlreadyExists: boolean): string {
  if (!/^[a-f0-9]{64}$/iu.test(sha256)) throw new Error("SHA-256 de currículo inválido.");
  return canonicalAlreadyExists ? `${baseVersion}-${sha256.slice(0, 8).toLowerCase()}` : baseVersion;
}

export function isCandidateResumeKey(resumeKey: string): boolean {
  return !resumeKey.startsWith("reference-");
}

export function resumeMatchesBaseKey(resumeKey: string, baseKey: string): boolean {
  return resumeKey === baseKey || resumeKey.startsWith(`${baseKey}-v`);
}
