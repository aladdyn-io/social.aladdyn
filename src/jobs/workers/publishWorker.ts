/**
 * Publish Worker
 *
 * Processes posts from the publish queue:
 * 1. Fetch post + campaign (with IG credentials)
 * 2. Publish to Instagram via Meta Graph API
 * 3. Update post status → POSTED or FAILED
 */

import { Worker, Job } from 'bullmq';
import prisma from '../../lib/prisma';
import { redisConnection } from '../redis';
import { QUEUE_NAMES, PublishJobData, engagementPollQueue } from '../queues';
import { publishToInstagram, IgContentType } from '../../services/instagramPublisher';
import { createLogger } from '../../utils/logger';
import { createPublishLog } from '../../db/database';

const logger = createLogger({ service: 'publish-worker' });

/**
 * Classifies a publish error into a user-friendly message and decides
 * whether a retry is worth attempting.
 *
 * Non-retryable cases (retrying would produce the same error):
 *   - Instagram token expired/invalid (Meta error code 190)
 *   - Missing required media (image/video URL not set)
 *   - Unsupported content type for the platform
 *   - Missing platform credentials
 */
function classifyPublishError(
  raw: string,
  platform: string
): { message: string; isNonRetryable: boolean } {
  // Meta Graph API token errors — code 190 covers expired + revoked tokens
  if (raw.includes('code=190') || (raw.includes('OAuthException') && raw.includes('token'))) {
    return {
      message:
        'Instagram access token expired or revoked. Reconnect your Instagram account in the Social Scene settings to resume publishing.',
      isNonRetryable: true,
    };
  }

  // Instagram permission errors (code 200-series) — user revoked app permissions
  if (raw.includes('code=200') || raw.includes('permissions')) {
    return {
      message:
        'Instagram publishing permission denied. Re-authorise the Aladdyn app in your Instagram settings.',
      isNonRetryable: true,
    };
  }

  // Missing media — no retry will fix a missing imageUrl/videoUrl
  if (raw.includes('imageUrl required') || raw.includes('videoUrl required')) {
    return {
      message: `${platform === 'instagram' ? 'Instagram' : 'LinkedIn'} post has no media attached. Generate or upload an image before publishing.`,
      isNonRetryable: true,
    };
  }

  // Missing credentials — no retry will fix a missing token/userId
  if (raw.includes('no Instagram credentials') || raw.includes('no funnelId')) {
    return {
      message: raw,
      isNonRetryable: true,
    };
  }

  // Unsupported content type
  if (raw.includes('not supported') || raw.includes('Unknown contentType')) {
    return { message: raw, isNonRetryable: true };
  }

  // LinkedIn service returned a 4xx — likely a data problem, not a transient error
  if (raw.includes('LinkedIn service error (4')) {
    return { message: raw, isNonRetryable: true };
  }

  // Everything else is treated as transient (network blip, rate limit, API 5xx)
  return { message: raw, isNonRetryable: false };
}

async function processPublish(job: Job<PublishJobData>): Promise<void> {
  const { postId, campaignId, platform } = job.data;

  logger.info('Processing post', { postId, platform });

  // Lock the post
  await prisma.socialPost.update({
    where: { id: postId },
    data: { status: 'PUBLISHING' },
  });

  try {
    const post = await prisma.socialPost.findUniqueOrThrow({
      where: { id: postId },
      include: {
        campaign: {
          select: { igUserId: true, accessToken: true, funnelId: true, userId: true },
        },
      },
    });

    let platformPostId: string;
    let fallbackNote: string | null = null;

    if (platform === 'instagram') {
      const { igUserId, accessToken, funnelId } = post.campaign;

      if (!igUserId || !accessToken) {
        // No Instagram credentials — fall back to LinkedIn if the campaign has a funnelId
        if (funnelId) {
          logger.warn(
            'No Instagram credentials — falling back to LinkedIn publish',
            { postId, campaignId }
          );
          platformPostId = await publishViaLinkedIn({ post, funnelId, campaignId });
          fallbackNote = 'Published to LinkedIn (Instagram not connected)';
        } else {
          throw new Error(
            `Campaign ${campaignId} has no Instagram credentials. ` +
              'Connect an Instagram account before publishing.'
          );
        }
      } else {
        const result = await publishToInstagram({
          igUserId,
          accessToken,
          contentType: post.contentType as IgContentType,
          caption: buildCaption(post.caption, post.hashtags),
          imageUrl: post.imageUrl ?? undefined,
          shareToFeed: true,
        });

        platformPostId = result.mediaId;
      }
    } else if (platform === 'linkedin') {
      const { funnelId } = post.campaign;

      if (!funnelId) {
        throw new Error(
          `Campaign ${campaignId} has no funnelId — cannot route to LinkedIn service`
        );
      }

      platformPostId = await publishViaLinkedIn({ post, funnelId, campaignId });
    } else {
      throw new Error(`Platform "${platform}" is not supported`);
    }

    await prisma.socialPost.update({
      where: { id: postId },
      data: {
        status: 'POSTED',
        publishedAt: new Date(),
        platformPostId,
        publishAttempts: { increment: 1 },
        publishError: fallbackNote, // null for normal publish; note for LinkedIn fallback
      },
    });

    await createPublishLog({
      postId,
      campaignId,
      platform,
      attempt: job.attemptsMade + 1,
      status: 'succeeded',
      jobId: job.id ?? undefined,
    });

    logger.info('Post published', { postId, platform, platformPostId });

    // Enqueue engagement poll 30 minutes after publish (Instagram only for now)
    if (platform === 'instagram' && post.campaign.funnelId && post.campaign.userId) {
      await engagementPollQueue.add(
        `engagement-poll-${postId}`,
        {
          postId,
          platformPostId,
          platform,
          funnelId: post.campaign.funnelId,
          userId: post.campaign.userId,
        },
        {
          delay: 30 * 60 * 1000, // 30 minutes
          jobId: `engagement-poll-${postId}`,
        }
      );
      logger.info('Engagement poll scheduled in 30 min', { postId });
    }
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    logger.error('Publish failed', { postId, platform, error: rawMessage });

    // Classify the failure so the user sees an actionable error message
    const { message, isNonRetryable } = classifyPublishError(rawMessage, platform);

    // Non-retryable failures (expired token, unsupported media, etc.) skip retries
    // and go straight to FAILED — retrying would produce the same error.
    const isFinalAttempt =
      isNonRetryable || job.attemptsMade >= (job.opts.attempts ?? 1) - 1;

    await prisma.socialPost.update({
      where: { id: postId },
      data: {
        status: isFinalAttempt ? 'FAILED' : 'PUBLISHING',
        publishError: message,
        publishAttempts: { increment: 1 },
      },
    });

    await createPublishLog({
      postId,
      campaignId,
      platform,
      attempt: job.attemptsMade + 1,
      status: 'failed',
      error: message,
      jobId: job.id ?? undefined,
    });

    if (isNonRetryable) {
      // Swallow the error so BullMQ marks the job as completed (not failed/retried).
      // The post is already in FAILED status — no retry will succeed.
      logger.warn('Non-retryable error — skipping BullMQ retry', { postId, reason: message });
      return;
    }

    throw err; // Let BullMQ handle retries for transient errors
  }
}

/** Publishes a post to linkedin.aladdyn via the internal API. Returns the platformPostId. */
async function publishViaLinkedIn(params: {
  post: { caption: string | null; hashtags: string[]; imageUrl: string | null; scheduledDate: Date; scheduledTime: string };
  funnelId: string;
  campaignId: string;
}): Promise<string> {
  const { post, funnelId } = params;
  const linkedinServiceUrl = process.env.LINKEDIN_SERVICE_URL || 'http://localhost:4002';
  const internalSecret = process.env.INTERNAL_API_SECRET || 'aladdyn-internal-secret';

  const caption = buildCaption(post.caption, post.hashtags);
  const scheduledAt = `${post.scheduledDate.toISOString().split('T')[0]}T${post.scheduledTime}:00`;

  const liRes = await fetch(`${linkedinServiceUrl}/internal/posts/create-from-social`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': internalSecret,
    },
    body: JSON.stringify({
      funnelId,
      text: caption,
      imageUrls: post.imageUrl ? [post.imageUrl] : [],
      scheduledAt,
    }),
  });

  if (!liRes.ok) {
    const errText = await liRes.text();
    throw new Error(`LinkedIn service error (${liRes.status}): ${errText}`);
  }

  const liData = (await liRes.json()) as { data: { postId: string } };
  return liData.data.postId;
}

/** Merges caption text + hashtags into the final IG caption string */
function buildCaption(caption: string | null, hashtags: string[]): string {
  const parts: string[] = [];
  if (caption) parts.push(caption.trim());
  if (hashtags.length > 0) {
    parts.push(hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' '));
  }
  return parts.join('\n\n').slice(0, 2200);
}

export function startPublishWorker(): Worker<PublishJobData> {
  const worker = new Worker<PublishJobData>(QUEUE_NAMES.PUBLISH, processPublish, {
    connection: redisConnection,
    concurrency: 3,
  });

  worker.on('completed', (job) => {
    logger.info('Job completed', { jobId: job.id ?? '' });
  });

  worker.on('failed', (job, err) => {
    logger.error('Job failed', { jobId: job?.id ?? '', error: err.message });
  });

  logger.info('Started', { concurrency: '3' });
  return worker;
}
