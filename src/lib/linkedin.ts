import type { FormatType, Post } from "@prisma/client";

const LINKEDIN_API = "https://api.linkedin.com/v2";

function requireLinkedInConfig(): { accessToken: string; personUrn: string } {
  const accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
  const personUrn = process.env.LINKEDIN_PERSON_URN;
  if (!accessToken || !personUrn) {
    throw new Error("LINKEDIN_ACCESS_TOKEN e LINKEDIN_PERSON_URN são obrigatórios.");
  }
  return { accessToken, personUrn };
}

async function linkedinJson<T>(path: string, init: RequestInit): Promise<T> {
  const { accessToken } = requireLinkedInConfig();
  const response = await fetch(`${LINKEDIN_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`LinkedIn ${response.status}: ${details.slice(0, 500)}`);
  }
  return (await response.json()) as T;
}

interface RegisteredUpload {
  value?: {
    asset?: string;
    uploadMechanism?: {
      "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"?: {
        uploadUrl?: string;
      };
    };
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
  const recipe = isImage
    ? "urn:li:digitalmediaRecipe:feedshare-image"
    : "urn:li:digitalmediaRecipe:feedshare-document";

  const registered = await linkedinJson<RegisteredUpload>("/assets?action=registerUpload", {
    method: "POST",
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: [recipe],
        owner: personUrn,
        serviceRelationships: [
          {
            relationshipType: "OWNER",
            identifier: "urn:li:userGeneratedContent",
          },
        ],
        ...(isImage ? {} : { supportedUploadMechanism: ["SYNCHRONOUS_UPLOAD"] }),
      },
    }),
  });

  const upload =
    registered.value?.uploadMechanism?.[
      "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
    ];
  const asset = registered.value?.asset;
  if (!upload?.uploadUrl || !asset) {
    throw new Error("LinkedIn não retornou os dados de upload do asset.");
  }

  const uploadResponse = await fetch(upload.uploadUrl, {
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
  return asset;
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
              title: post.title,
              id: asset,
            },
          },
        }
      : {}),
  };

  const response = await linkedinJson<LinkedInPostResponse>("/posts", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const id = response.id;
  if (!id) {
    throw new Error("LinkedIn não retornou o identificador da publicação.");
  }
  return { id };
}
