export function weeklyGenerationKeys(weekKey: string, count: number): string[] {
  const boundedCount = Math.max(0, Math.min(4, Math.floor(count)));
  return Array.from({ length: boundedCount }, (_, index) => `weekly:${weekKey}:slot:${index}`);
}

function normalizeTitle(title: string): string {
  return title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeWord(word: string): string {
  return word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
}

export function hasDuplicatePostTitle(candidate: string, existingTitles: string[], threshold = 0.82): boolean {
  const normalized = normalizeTitle(candidate);
  if (!normalized) return false;
  const words = new Set(normalized.split(/\s+/).filter((word) => word.length > 2).map(normalizeWord));
  return existingTitles.some((existing) => {
    const existingNormalized = normalizeTitle(existing);
    if (existingNormalized === normalized) return true;
    const existingWords = new Set(existingNormalized.split(/\s+/).filter((word) => word.length > 2).map(normalizeWord));
    if (words.size < 4 || existingWords.size < 4) return false;
    const intersection = [...words].filter((word) => existingWords.has(word)).length;
    const union = new Set([...words, ...existingWords]).size;
    return union > 0 && intersection / union >= threshold;
  });
}
