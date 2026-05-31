/**
 * On-Demand Video Generation Service
 *
 * Orchestrates video generation for reel and story posts using the Kling AI API.
 * Mirrors the structure of onDemandImageGeneration.ts but produces MP4 files.
 *
 * Workflow:
 *   1. Fetch post + campaign from DB
 *   2. Validate contentType is reel or story
 *   3. Derive VideoConfig from platform + contentType
 *   4. Use stored videoPrompt or generate one on-the-fly
 *   5. Call KlingVideoGenerator.generateVideo() → Buffer
 *   6. Upload to MinIO as video/mp4
 *   7. Update post record (imageUrl, mediaType, imageGenerated)
 *
 * Fallback: if Kling fails for any reason, falls back to generatePostImage()
 * and marks the post with isFallback = true.
 */

import prisma from '../lib/prisma';
import { KlingVideoGenerator, VideoConfig, VideoGenerationError, VideoTimeoutError } from './videoGenerator';
import { generateDetailedVideoPrompt } from './generateVideoPrompt';
import * as onDemandImage from './onDemandImageGeneration';
import * as objectStorage from './objectStorage';
import { getPostById } from '../db/database';
import { createLogger } from '../utils/logger';

const logger = createLogger({ service: 'on-demand-video' });

// ── Platform video config lookup ──────────────────────────────────────────────

const PLATFORM_VIDEO_CONFIGS: Record<string, Record<string, VideoConfig>> = {
  instagram: {
    reel:  { aspectRatio: '9:16', duration: '10', modelName: 'kling-v1', mode: 'std' },
    story: { aspectRatio: '9:16', duration: '5',  modelName: 'kling-v1', mode: 'std' },
  },
  linkedin: {
    reel:  { aspectRatio: '16:9', duration: '10', modelName: 'kling-v1', mode: 'std' },
    story: { aspectRatio: '9:16', duration: '5',  modelName: 'kling-v1', mode: 'std' },
  },
  whatsapp: {
    reel:  { aspectRatio: '9:16', duration: '10', modelName: 'kling-v1', mode: 'std' },
    story: { aspectRatio: '9:16', duration: '5',  modelName: 'kling-v1', mode: 'std' },
  },
};

const DEFAULT_VIDEO_CONFIG: VideoConfig = {
  aspectRatio: '9:16',
  duration: '5',
  modelName: 'kling-v1',
  mode: 'std',
};

/**
 * Returns the VideoConfig for a given platform + contentType combination.
 * Always returns a valid config — never undefined or null.
 */
export function deriveVideoConfig(platform: string, contentType: string): VideoConfig {
  const platformKey = (platform ?? '').toLowerCase();
  const typeKey = (contentType ?? '').toLowerCase();
  return PLATFORM_VIDEO_CONFIGS[platformKey]?.[typeKey] ?? DEFAULT_VIDEO_CONFIG;
}

/**
 * Returns true if the contentType should produce a video (reel or story).
 * Returns false for all other values including unrecognised strings.
 */
export function isVideoContentType(contentType: string): boolean {
  const t = (contentType ?? '').toLowerCase();
  return t === 'reel' || t === 'story';
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generates a video on-demand for a specific post.
 *
 * @param postId - UUID of the SocialPost
 * @param force  - If true, regenerates even if imageUrl is already set
 * @returns      Public MinIO URL of the generated video (or fallback image)
 */
export async function generatePostVideo(
  postId: string,
  force: boolean = false
): Promise<string> {
  logger.info(`Starting on-demand video generation for post: ${postId} (force: ${force})`);

  // ── Step 1: Fetch post ────────────────────────────────────────────────────
  const post = await getPostById(postId);
  if (!post) {
    throw new Error(`Post not found: ${postId}`);
  }

  // ── Step 2: Validate content type ────────────────────────────────────────
  if (!isVideoContentType(post.contentType)) {
    throw new Error(
      `Post ${postId} has contentType '${post.contentType}' — only reel and story posts can generate videos`
    );
  }

  // ── Step 3: Short-circuit if already generated ───────────────────────────
  if (post.imageUrl && post.imageGenerated && !force) {
    logger.info(`Post ${postId} already has generated media: ${post.imageUrl}`);
    return post.imageUrl;
  }

  // ── Step 4: Fetch campaign branding ──────────────────────────────────────
  const campaign = await prisma.socialCampaign.findUnique({
    where: { id: post.campaignId },
    select: {
      companyName: true,
      name: true,
      industry: true,
      geography: true,
      services: true,
      brandColor: true,
      accentColor: true,
    },
  });

  // ── Step 5: Derive VideoConfig ────────────────────────────────────────────
  const config = deriveVideoConfig(post.platform, post.contentType);
  logger.info(`Derived VideoConfig for ${post.platform}/${post.contentType}`, {
    aspectRatio: config.aspectRatio,
    duration: config.duration,
    modelName: config.modelName,
  });

  // ── Step 6: Resolve video prompt ─────────────────────────────────────────
  let videoPrompt: string = post.videoPrompt ?? '';

  if (!videoPrompt) {
    logger.info(`No stored videoPrompt for post ${postId} — generating on-the-fly`);
    // Build minimal CalendarItem + NormalizedInput from post data for prompt generation
    const calendarItem = {
      date: new Date(post.scheduledDate).toISOString().split('T')[0],
      pillar: post.contentPillar ?? 'General',
      topic: post.topic ?? post.contentPillar ?? 'Brand content',
      content_type: post.contentType,
      is_festival: post.isFestival ?? false,
      festival_name: post.festivalName ?? undefined,
      platform: post.platform,
    };
    const normalizedInput: any = {
      industry: campaign?.industry ?? 'Business',
      services: campaign?.services ?? [],
      geography: campaign?.geography ?? 'India',
      base_color: campaign?.brandColor ?? '#764ba2',
      accent_color: campaign?.accentColor ?? '#667eea',
      platform: post.platform,
    };
    const strategy: any = { tone: 'professional and engaging', content_pillars: [] };

    videoPrompt = await generateDetailedVideoPrompt(calendarItem as any, strategy, normalizedInput);
  }

  // ── Step 7: Generate video via Kling ─────────────────────────────────────
  try {
    const generator = new KlingVideoGenerator();
    const videoBuffer = await generator.generateVideo(videoPrompt, config);

    logger.info(`✓ Kling video generated for post ${postId} (${videoBuffer.length} bytes)`);

    // ── Step 8: Upload to MinIO ─────────────────────────────────────────────
    const videoUrl = await objectStorage.uploadBufferToStorage(
      videoBuffer,
      'video/mp4',
      `posts/${postId}/video/`
    );
    logger.info(`✓ Video uploaded to MinIO: ${videoUrl}`);

    // ── Step 9: Update post record ──────────────────────────────────────────
    await prisma.socialPost.update({
      where: { id: postId },
      data: {
        imageUrl: videoUrl,
        imageGenerated: true,
        imageModel: config.modelName,
        mediaType: 'video',
        isFallback: false,
      },
    });

    logger.info(`✓ Post ${postId} updated with video URL`);
    return videoUrl;

  } catch (videoErr: any) {
    // ── Fallback: generate static image instead ─────────────────────────────
    logger.warn(
      `Video generation failed for post ${postId} — falling back to static image`,
      {
        error: videoErr.message,
        platform: post.platform,
        contentType: post.contentType,
      }
    );

    const imageUrl = await onDemandImage.generatePostImage(postId, false, force);

    // Mark as fallback
    await prisma.socialPost.update({
      where: { id: postId },
      data: {
        mediaType: 'image',
        isFallback: true,
      },
    });

    logger.info(`✓ Fallback image generated for post ${postId}: ${imageUrl}`);
    return imageUrl;
  }
}

/**
 * Batch generates videos for multiple posts sequentially.
 * Per-post errors are caught and recorded without aborting the batch.
 *
 * @param postIds - Array of SocialPost UUIDs
 * @returns       Map of postId → { success, videoUrl?, error? }
 */
export async function generatePostVideos(
  postIds: string[]
): Promise<Map<string, { success: boolean; videoUrl?: string; error?: string }>> {
  logger.info(`Batch generating videos for ${postIds.length} posts...`);

  const results = new Map<string, { success: boolean; videoUrl?: string; error?: string }>();

  for (const postId of postIds) {
    try {
      const videoUrl = await generatePostVideo(postId);
      results.set(postId, { success: true, videoUrl });
      logger.info(`[Batch] ✓ ${postId}`);
    } catch (err: any) {
      logger.error(`[Batch] ✗ ${postId}: ${err.message}`);
      results.set(postId, { success: false, error: err.message });
    }
  }

  const successCount = Array.from(results.values()).filter((r) => r.success).length;
  logger.info(`[Batch] Complete: ${successCount}/${postIds.length} succeeded`);

  return results;
}
