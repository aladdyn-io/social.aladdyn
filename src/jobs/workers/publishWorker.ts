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
import { QUEUE_NAMES, PublishJobData } from '../queues';
import { publishToInstagram, IgContentType } from '../../services/instagramPublisher';
import { createLogger } from '../../utils/logger';

const logger = createLogger({ service: 'publish-worker' });

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
          select: { igUserId: true, accessToken: true, funnelId: true },
        },
      },
    });

    let platformPostId: string;

    if (platform === 'instagram') {
      const { igUserId, accessToken } = post.campaign;

      if (!igUserId || !accessToken) {
        throw new Error(
          `Campaign ${campaignId} has no Instagram credentials. ` +
            'Connect an Instagram account before publishing.'
        );
      }

      const result = await publishToInstagram({
        igUserId,
        accessToken,
        contentType: post.contentType as IgContentType,
        caption: buildCaption(post.caption, post.hashtags),
        imageUrl: post.imageUrl ?? undefined,
        shareToFeed: true,
      });

      platformPostId = result.mediaId;
    } else if (platform === 'linkedin') {
      const { funnelId } = post.campaign;

      if (!funnelId) {
        throw new Error(
          `Campaign ${campaignId} has no funnelId — cannot route to LinkedIn service`
        );
      }

      const linkedinServiceUrl =
        process.env.LINKEDIN_SERVICE_URL || 'http://localhost:4002';
      const internalSecret =
        process.env.INTERNAL_API_SECRET || 'aladdyn-internal-secret';

      const caption = buildCaption(post.caption, post.hashtags);
      const scheduledAt = `${post.scheduledDate.toISOString().split('T')[0]}T${post.scheduledTime}:00`;

      const liRes = await fetch(
        `${linkedinServiceUrl}/internal/posts/create-from-social`,
        {
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
        }
      );

      if (!liRes.ok) {
        const errText = await liRes.text();
        throw new Error(`LinkedIn service error (${liRes.status}): ${errText}`);
      }

      const liData = (await liRes.json()) as { data: { postId: string } };
      platformPostId = liData.data.postId;
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
        publishError: null,
      },
    });

    logger.info('Post published', { postId, platform, platformPostId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Publish failed', { postId, platform, error: message });

    await prisma.socialPost.update({
      where: { id: postId },
      data: {
        status: 'FAILED',
        publishError: message,
        publishAttempts: { increment: 1 },
      },
    });

    throw err; // Let BullMQ handle retries
  }
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
