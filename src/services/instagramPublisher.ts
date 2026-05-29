/**
 * Instagram Publisher
 *
 * Publishes posts to Instagram Business/Creator accounts via the Meta Graph API v25.0.
 * Implements the two-step flow: create container → poll (videos) → publish.
 *
 * Supports: photo, carousel, reel, story
 *
 * Rate limits (enforced by Meta):
 *   - 100 published posts per 24-hour rolling window per IG account
 *   - 400 container creations per 24-hour rolling window
 *
 * Docs: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/content-publishing
 */

import axios, { AxiosError } from 'axios';

const GRAPH_API = 'https://graph.instagram.com/v25.0';

// Max attempts to poll container status before giving up (1 poll/min = 5 min total)
const POLL_MAX_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 60_000;

export type IgContentType = 'photo' | 'reel' | 'carousel' | 'story' | 'written';

export interface IgPublishParams {
  igUserId: string;
  accessToken: string;
  contentType: IgContentType;
  caption?: string;
  /** Publicly accessible JPEG URL (photo/carousel-item/story-image) */
  imageUrl?: string;
  /** Publicly accessible MP4/MOV URL (reel/story-video) */
  videoUrl?: string;
  /** For carousel: array of publicly accessible JPEG/MP4 URLs (2–10 items) */
  carouselItems?: string[];
  /** Reels: share in Feed tab as well */
  shareToFeed?: boolean;
}

export interface IgPublishResult {
  /** Live Instagram Media ID */
  mediaId: string;
  /** Constructed permalink */
  permalink?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function graphUrl(path: string): string {
  return `${GRAPH_API}${path}`;
}

function igError(err: unknown, context: string): never {
  if (err instanceof AxiosError) {
    const data = err.response?.data as Record<string, unknown> | undefined;
    const meta = data?.error as Record<string, unknown> | undefined;
    // Print full API error for debugging
    console.error(`[Instagram] ${context} — HTTP ${err.response?.status}:`, JSON.stringify(data, null, 2));
    throw new Error(
      `[Instagram] ${context}: ${meta?.message ?? err.message} ` +
        `(code=${meta?.code ?? '?'} subcode=${meta?.error_subcode ?? '?'})`
    );
  }
  throw err;
}

// ── Container creation ────────────────────────────────────────────────────────

async function createImageContainer(
  igUserId: string,
  accessToken: string,
  imageUrl: string,
  caption?: string,
  isCarouselItem = false
): Promise<string> {
  try {
    const params: Record<string, unknown> = {
      image_url: imageUrl,
      access_token: accessToken,
    };
    if (isCarouselItem) {
      params.is_carousel_item = true;
    } else if (caption) {
      params.caption = caption.slice(0, 2200);
    }

    const res = await axios.post<{ id: string }>(
      graphUrl(`/${igUserId}/media`),
      params
    );
    return res.data.id;
  } catch (err) {
    igError(err, 'createImageContainer');
  }
}

async function createVideoContainer(
  igUserId: string,
  accessToken: string,
  videoUrl: string,
  mediaType: 'REELS' | 'STORIES',
  caption?: string,
  shareToFeed?: boolean
): Promise<string> {
  try {
    const params: Record<string, unknown> = {
      media_type: mediaType,
      video_url: videoUrl,
      access_token: accessToken,
    };
    if (caption) params.caption = caption.slice(0, 2200);
    if (mediaType === 'REELS' && shareToFeed !== undefined) {
      params.share_to_feed = shareToFeed;
    }

    const res = await axios.post<{ id: string }>(
      graphUrl(`/${igUserId}/media`),
      params
    );
    return res.data.id;
  } catch (err) {
    igError(err, 'createVideoContainer');
  }
}

async function createCarouselContainer(
  igUserId: string,
  accessToken: string,
  childIds: string[],
  caption?: string
): Promise<string> {
  try {
    const params: Record<string, unknown> = {
      media_type: 'CAROUSEL',
      children: childIds.join(','),
      access_token: accessToken,
    };
    if (caption) params.caption = caption.slice(0, 2200);

    const res = await axios.post<{ id: string }>(
      graphUrl(`/${igUserId}/media`),
      params
    );
    return res.data.id;
  } catch (err) {
    igError(err, 'createCarouselContainer');
  }
}

// ── Container status polling ──────────────────────────────────────────────────

type ContainerStatus = 'IN_PROGRESS' | 'FINISHED' | 'PUBLISHED' | 'ERROR' | 'EXPIRED';

async function pollContainerStatus(
  containerId: string,
  accessToken: string,
  maxAttempts = POLL_MAX_ATTEMPTS,
  intervalMs = POLL_INTERVAL_MS
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleep(intervalMs);

    let statusCode: ContainerStatus;
    try {
      const res = await axios.get<{ status_code: ContainerStatus; id: string }>(
        graphUrl(`/${containerId}`),
        { params: { fields: 'status_code', access_token: accessToken } }
      );
      statusCode = res.data.status_code;
    } catch (err) {
      igError(err, `pollContainerStatus attempt ${attempt}`);
    }

    console.log(`[Instagram] Container ${containerId} status: ${statusCode} (attempt ${attempt}/${maxAttempts})`);

    if (statusCode === 'FINISHED') return;
    if (statusCode === 'ERROR') {
      throw new Error(`[Instagram] Container ${containerId} entered ERROR state`);
    }
    if (statusCode === 'EXPIRED') {
      throw new Error(`[Instagram] Container ${containerId} expired before publishing`);
    }
    // IN_PROGRESS or PUBLISHED → keep polling
  }

  throw new Error(
    `[Instagram] Container ${containerId} did not finish processing after ${maxAttempts} attempts`
  );
}

// ── Publish step ─────────────────────────────────────────────────────────────

async function publishContainer(
  igUserId: string,
  accessToken: string,
  containerId: string
): Promise<string> {
  try {
    const res = await axios.post<{ id: string }>(
      graphUrl(`/${igUserId}/media_publish`),
      { creation_id: containerId, access_token: accessToken }
    );
    return res.data.id;
  } catch (err) {
    igError(err, 'publishContainer');
  }
}

// ── Rate limit check ──────────────────────────────────────────────────────────

export async function checkPublishingQuota(
  igUserId: string,
  accessToken: string
): Promise<{ used: number; total: number }> {
  try {
    const res = await axios.get<{
      data: Array<{ config: { quota_total: number }; quota_usage: number }>;
    }>(graphUrl(`/${igUserId}/content_publishing_limit`), {
      params: { fields: 'config,quota_usage', access_token: accessToken },
    });
    const entry = res.data.data[0];
    return { used: entry?.quota_usage ?? 0, total: entry?.config?.quota_total ?? 100 };
  } catch {
    // Non-fatal — proceed and let Meta enforce the limit
    return { used: 0, total: 100 };
  }
}

// ── Main publish entry point ──────────────────────────────────────────────────

export async function publishToInstagram(
  params: IgPublishParams
): Promise<IgPublishResult> {
  const { igUserId, accessToken, contentType, caption, imageUrl, videoUrl, carouselItems, shareToFeed } = params;

  let containerId: string;
  let needsStatusPoll = false;

  switch (contentType) {
    case 'photo': {
      if (!imageUrl) throw new Error('[Instagram] imageUrl required for photo post');
      containerId = await createImageContainer(igUserId, accessToken, imageUrl, caption);
      break;
    }

    case 'reel': {
      if (!videoUrl) throw new Error('[Instagram] videoUrl required for reel');
      containerId = await createVideoContainer(
        igUserId, accessToken, videoUrl, 'REELS', caption, shareToFeed
      );
      needsStatusPoll = true;
      break;
    }

    case 'story': {
      if (!imageUrl && !videoUrl) {
        throw new Error('[Instagram] imageUrl or videoUrl required for story');
      }
      if (videoUrl) {
        containerId = await createVideoContainer(
          igUserId, accessToken, videoUrl, 'STORIES'
        );
        needsStatusPoll = true;
      } else {
        // image story — no media_type needed, no caption on stories
        containerId = await createImageContainer(igUserId, accessToken, imageUrl!);
      }
      break;
    }

    case 'carousel': {
      const items = carouselItems ?? (imageUrl ? (imageUrl.includes(',') ? imageUrl.split(',') : [imageUrl]) : []);
      if (items.length < 2 || items.length > 10) {
        throw new Error(
          `[Instagram] Carousel requires 2–10 items, got ${items.length}`
        );
      }
      // Create a child container for each item
      const childIds = await Promise.all(
        items.map((url) =>
          createImageContainer(igUserId, accessToken, url, undefined, true)
        )
      );
      containerId = await createCarouselContainer(igUserId, accessToken, childIds, caption);
      break;
    }

    case 'written':
      // Instagram has no text-only post type — skip silently
      throw new Error('[Instagram] Written/text-only posts are not supported on Instagram');

    default:
      throw new Error(`[Instagram] Unknown contentType: ${contentType}`);
  }

  console.log(`[Instagram] Container created: ${containerId} (type=${contentType})`);

  // All containers need to reach FINISHED before publishing.
  // Videos take longer (poll every 60s); photos/carousels are usually ready in a few seconds.
  if (needsStatusPoll) {
    // Video: poll every 60s, up to 5 attempts (5 min)
    await pollContainerStatus(containerId, accessToken, POLL_MAX_ATTEMPTS, POLL_INTERVAL_MS);
  } else {
    // Photo/carousel: poll every 3s, up to 10 attempts (30s max)
    await pollContainerStatus(containerId, accessToken, 10, 3_000);
  }

  const mediaId = await publishContainer(igUserId, accessToken, containerId);

  console.log(`[Instagram] Published media ${mediaId} for IG user ${igUserId}`);

  return {
    mediaId,
    permalink: `https://www.instagram.com/p/${mediaId}/`,
  };
}
