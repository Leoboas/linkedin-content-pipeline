import type { FormatType, Post } from "@prisma/client";

const LINKEDIN_REST_API = "https://api.linkedin.com/rest";
const LINKEDIN_VERSION = process.env.LINKEDIN_VERSION ?? "202606";

export interface LinkedInMemberMetric {
  metricType: string;
  count: number;
}

function requireLinkedInConfig(): { accessToken: string; personUrn: string } {
  const accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
  const personUrn = process.env.LINKEDIN_PERSON_URN;
  if (!accessToken || !personUrn) {
    throw new Error("LINKEDIN_ACCESS_TOKEN e LINKEDIN_PERSON_URN são obrigatórios.");
  }
  return { accessToken, personUrn };
}

async function linkedinRestFetch(path: string, init: RequestInit): Promise<Response> {
  const { accessToken } = requireLinkedInConfig();
  return fetch(`${LINKEDIN_REST_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Linkedin-Version": LINKEDIN_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
    },
  });
}

async function linkedinRestJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await linkedinRestFetch(path, init);
  const details = await response.text();
  if (!response.ok) {
    throw new Error(`LinkedIn ${response.status}: ${details.slice(0, 500)}`);
  }
  if (!details.trim()) return {} as T;
  try {
    return JSON.parse(details) as T;
  } catch (error) {
    throw new Error(`LinkedIn retornou JSON inválido (${response.status}).`, { cause: error });
  }
}

export async function fetchLinkedInMemberPostMetrics(postUrn: string): Promise<LinkedInMemberMetric[]> {
  const normalizedUrn = postUrn.trim();
  if (!/^urn:li:(share|ugcPost):[A-Za-z0-9_-]+$/.test(normalizedUrn)) {
    throw new Error("linkedinPostId não é uma URN share/ugcPost válida.");
  }
  const entityType = normalizedUrn.includes(":ugcPost:") ? "ugc" : "share";
  const metrics = ["IMPRESSION", "REACTION", "COMMENT", "RESHARE"];
  const result: LinkedInMemberMetric[] = [];
  for (const metric of metrics) {
    const params = new URLSearchParams({
      q: "entity",
      entity: `(${entityType}:${normalizedUrn})`,
      queryType: metric,
      aggregation: "TOTAL",
    });
    const payload = await linkedinRestJson<{ elements?: Array<{ count?: number; metricType?: Record<string, string> | string }> }>(
      `/memberCreatorPostAnalytics?${params.toString()}`,
      { method: "GET" },
    );
    const element = payload.elements?.[0];
    const metricType = typeof element?.metricType === "string"
      ? element.metricType
      : element?.metricType && typeof element.metricType === "object"
        ? Object.values(element.metricType)[0]
        : metric;
    result.push({ metricType: metricType ?? metric, count: Math.max(0, Math.round(Number(element?.count ?? 0))) });
  }
  return result;
}

interface InitializedUpload {
  value?: {
    uploadUrl?: string;
    image?: string;
    document?: string;
  };
}

async function registerAndUploadMedia(
  mediaUrl: string,
  formatType: FormatType,
  title: string,
): Promise<string> {
  const { personUrn, accessToken } = requireLinkedInConfig();
  const mediaResponse = await fetch(mediaUrl);
  if (!mediaResponse.ok) {
    throw new Error(`Não foi possível baixar a mídia para o LinkedIn (${mediaResponse.status}).`);
  }
  const media = await mediaResponse.arrayBuffer();
  const isImage = formatType === "SINGLE_IMAGE";
  const registered = await linkedinRestJson<InitializedUpload>(
    isImage ? "/images?action=initializeUpload" : "/documents?action=initializeUpload",
    {
    method: "POST",
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: personUrn,
      },
    }),
    },
  );

  const uploadUrl = registered.value?.uploadUrl;
  const mediaId = isImage ? registered.value?.image : registered.value?.document;
  if (!uploadUrl || !mediaId) {
    throw new Error("LinkedIn não retornou os dados de upload da mídia.");
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": isImage ? "image/png" : "application/pdf",
      "Content-Length": String(media.byteLength),
    },
    body: media,
  });
  if (!uploadResponse.ok) {
    throw new Error(`Upload do asset no LinkedIn falhou (${uploadResponse.status}).`);
  }

  void title;
  return mediaId;
}

interface LinkedInPostResponse {
  id?: string;
}

export async function publishPostToLinkedIn(
  post: Pick<Post, "title" | "textContent" | "mediaUrl" | "formatType">,
): Promise<{ id: string }> {
  const { personUrn } = requireLinkedInConfig();
  const asset = post.mediaUrl
    ? await registerAndUploadMedia(post.mediaUrl, post.formatType, post.title)
    : undefined;

  const body = {
    author: personUrn,
    lifecycleState: "PUBLISHED",
    commentary: post.textContent,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    ...(asset
      ? {
          content: {
            media: {
              ...(post.formatType === "SINGLE_IMAGE" ? { altText: post.title } : { title: post.title }),
              id: asset,
            },
          },
        }
      : {}),
  };

  const response = await linkedinRestFetch("/posts", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const responseText = await response.text();
  if (!response.ok) {
    if (response.status === 422 && responseText.includes("DUPLICATE_POST")) {
      const duplicateId = responseText.match(/urn:li:(?:share|ugcPost):[A-Za-z0-9_-]+/)?.[0];
      if (duplicateId) return { id: duplicateId };
    }
    throw new Error(`LinkedIn ${response.status}: ${responseText.slice(0, 500)}`);
  }
  let parsed: LinkedInPostResponse = {};
  if (responseText.trim()) {
    try {
      parsed = JSON.parse(responseText) as LinkedInPostResponse;
    } catch (error) {
      throw new Error(`LinkedIn retornou JSON inválido (${response.status}).`, { cause: error });
    }
  }
  const id = parsed.id ?? response.headers.get("x-restli-id") ?? undefined;
  if (!id) {
    throw new Error("LinkedIn não retornou o identificador da publicação.");
  }
  return { id };
}
