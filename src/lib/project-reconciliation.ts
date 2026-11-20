export interface ProjectMatchCandidate {
  postId: string;
  legacyProjectText: string;
  projectKey: string;
  projectName: string;
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

/** Suggestions only: matching names never constitute user confirmation. */
export function suggestProjectMatches(input: {
  posts: Array<{ id: string; associatedProject: string | null }>;
  projects: Array<{ projectKey: string; name: string }>;
}): ProjectMatchCandidate[] {
  const result: ProjectMatchCandidate[] = [];
  for (const post of input.posts) {
    if (!post.associatedProject?.trim()) continue;
    const normalizedLegacy = normalize(post.associatedProject);
    const match = input.projects.find((project) => {
      const projectName = normalize(project.name);
      const projectKey = normalize(project.projectKey);
      return normalizedLegacy === projectName || normalizedLegacy === projectKey;
    });
    if (match) result.push({ postId: post.id, legacyProjectText: post.associatedProject, projectKey: match.projectKey, projectName: match.name });
  }
  return result;
}
