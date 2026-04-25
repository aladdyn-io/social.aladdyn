/**
 * Engagement Poll Worker
 *
 * Polls Meta Graph API for Instagram post comments and likes after a post
 * reaches POSTED status. Stores results in SocialEngagement table and
 * emits lead signals to server.aladdyn for each new engager.
 *
 * Triggered: publishWorker enqueues an engagement-poll job 30 min after
 * a post successfully publishes.
 *
 * Isolated — errors never affect other services.
 */

import { Worker, Job } from 'bullmq';
import axios from 'axios';
import prisma from '../../lib/prisma';
import { redisConnection } from '../redis';
import { QUEUE_NAMES, EngagementPollJobData } from '../queues';
import { createLogger } from '../../utils/logger';

const logger = createLogger({ service: 'engagement-poller' });

const GRAPH_API = 'https://graph.facebook.com/v25.0';
const SERVER_ALADDYN_URL = process.env.SERVER_ALADDYN_URL ?? 'http://localhost:3001';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? '';

interface IgComment {
  id: string;
  text: string;
  from?: { id: string; username?: string; name?: string };
  timestamp: string;
}

interface IgLike {
  id: string;
  name?: string;
  username?: string;
}

async function fetchIgComments(platformPostId: string, accessToken: string): Promise<IgComment[]> {
  try {
    const url = `${GRAPH_API}/${platformPostId}/comments`;
    const res = await axios.get(url, {
      params: {
        fields: 'id,text,from,timestamp',
        access_token: accessToken,
        limit: 100,
      },
      timeout: 15_000,
    });
    return (res.data?.data ?? []) as IgComment[];
  } catch (err) {
    logger.warn('Failed to fetch IG comments', { platformPostId, err });
    return [];
  }
}

async function fetchIgLikes(platformPostId: string, accessToken: string): Promise<IgLike[]> {
  try {
    const url = `${GRAPH_API}/${platformPostId}/likes`;
    const res = await axios.get(url, {
      params: {
        fields: 'id,name,username',
        access_token: accessToken,
        limit: 100,
      },
      timeout: 15_000,
    });
    return (res.data?.data ?? []) as IgLike[];
  } catch (err) {
    // Likes endpoint may be restricted — treat as non-fatal
    logger.warn('Failed to fetch IG likes (may be restricted)', { platformPostId, err });
    return [];
  }
}

async function emitLeadSignal(payload: {
  funnelId: string;
  userId: string;
  externalUserId: string;
  displayName?: string;
  engagementType: 'LIKE' | 'COMMENT';
  content?: string;
  postId: string;
  postCaption?: string;
}): Promise<void> {
  const idempotencyKey = `INSTAGRAM:${payload.postId}:${payload.externalUserId}:${payload.engagementType}`;

  try {
    const res = await fetch(`${SERVER_ALADDYN_URL}/internal/lead-signal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': INTERNAL_SECRET,
      },
      body: JSON.stringify({
        source: 'INSTAGRAM',
        funnelId: payload.funnelId,
        userId: payload.userId,
        externalProfileId: payload.externalUserId,
        name: payload.displayName,
        engagementType: payload.engagementType,
        content: payload.content,
        postId: payload.postId,
        postTitle: payload.postCaption?.slice(0, 80),
        idempotencyKey,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn('server.aladdyn rejected IG lead signal', {
        status: res.status,
        body: text.slice(0, 200),
      });
    }
  } catch (err) {
    logger.warn('Network error emitting IG lead signal', { err });
  }
}

async function processEngagementPoll(job: Job<EngagementPollJobData>): Promise<void> {
  const { postId, platformPostId, platform, funnelId, userId } = job.data;

  if (platform !== 'instagram') {
    // LinkedIn engagement is handled by linkedin.aladdyn — skip
    logger.info('Skipping non-instagram platform', { platform, postId });
    return;
  }

  logger.info('Polling engagement for post', { postId, platformPostId });

  // Get campaign for IG access token
  const post = await prisma.socialPost.findUnique({
    where: { id: postId },
    select: {
      caption: true,
      campaign: {
        select: { accessToken: true },
      },
    },
  });

  if (!post?.campaign?.accessToken) {
    logger.warn('No access token found for post campaign', { postId });
    return;
  }

  const accessToken = post.campaign.accessToken;
  const postCaption = post.caption ?? undefined;

  const [comments, likes] = await Promise.all([
    fetchIgComments(platformPostId, accessToken),
    fetchIgLikes(platformPostId, accessToken),
  ]);

  logger.info('Fetched engagement data', {
    postId,
    commentCount: comments.length,
    likeCount: likes.length,
  });

  const now = new Date();

  // Upsert comments
  for (const comment of comments) {
    const externalUserId = comment.from?.id ?? comment.id;
    const displayName = comment.from?.name ?? comment.from?.username;

    try {
      await prisma.socialEngagement.upsert({
        where: {
          postId_externalUserId_engagementType: {
            postId,
            externalUserId,
            engagementType: 'COMMENT',
          },
        },
        create: {
          postId,
          platform: 'instagram',
          externalUserId,
          displayName: displayName ?? null,
          engagementType: 'COMMENT',
          content: comment.text,
          engagedAt: new Date(comment.timestamp),
        },
        update: {
          content: comment.text,
          displayName: displayName ?? undefined,
        },
      });

      // Emit lead signal if not already done
      const existing = await prisma.socialEngagement.findUnique({
        where: {
          postId_externalUserId_engagementType: {
            postId,
            externalUserId,
            engagementType: 'COMMENT',
          },
        },
        select: { leadSignalSentAt: true },
      });

      if (!existing?.leadSignalSentAt) {
        await emitLeadSignal({
          funnelId,
          userId,
          externalUserId,
          displayName,
          engagementType: 'COMMENT',
          content: comment.text,
          postId,
          postCaption,
        });

        await prisma.socialEngagement.update({
          where: {
            postId_externalUserId_engagementType: {
              postId,
              externalUserId,
              engagementType: 'COMMENT',
            },
          },
          data: { leadSignalSentAt: now },
        });
      }
    } catch (err) {
      logger.warn('Failed to process comment engagement', { err, externalUserId });
    }
  }

  // Upsert likes
  for (const like of likes) {
    const externalUserId = like.id;
    const displayName = like.name ?? like.username;

    try {
      await prisma.socialEngagement.upsert({
        where: {
          postId_externalUserId_engagementType: {
            postId,
            externalUserId,
            engagementType: 'LIKE',
          },
        },
        create: {
          postId,
          platform: 'instagram',
          externalUserId,
          displayName: displayName ?? null,
          engagementType: 'LIKE',
          engagedAt: now,
        },
        update: {},
      });

      const existing = await prisma.socialEngagement.findUnique({
        where: {
          postId_externalUserId_engagementType: {
            postId,
            externalUserId,
            engagementType: 'LIKE',
          },
        },
        select: { leadSignalSentAt: true },
      });

      if (!existing?.leadSignalSentAt) {
        await emitLeadSignal({
          funnelId,
          userId,
          externalUserId,
          displayName,
          engagementType: 'LIKE',
          postId,
          postCaption,
        });

        await prisma.socialEngagement.update({
          where: {
            postId_externalUserId_engagementType: {
              postId,
              externalUserId,
              engagementType: 'LIKE',
            },
          },
          data: { leadSignalSentAt: now },
        });
      }
    } catch (err) {
      logger.warn('Failed to process like engagement', { err, externalUserId });
    }
  }

  logger.info('Engagement poll complete', { postId, commentCount: comments.length, likeCount: likes.length });
}

export function startEngagementPollWorker(): Worker<EngagementPollJobData> {
  const worker = new Worker<EngagementPollJobData>(
    QUEUE_NAMES.ENGAGEMENT_POLL,
    processEngagementPoll,
    {
      connection: redisConnection,
      concurrency: 3,
    }
  );

  worker.on('completed', (job) => {
    logger.info('Engagement poll job completed', { jobId: job.id });
  });

  worker.on('failed', (job, err) => {
    logger.error('Engagement poll job failed', {
      jobId: job?.id,
      attempt: job?.attemptsMade,
      error: err.message,
    });
  });

  worker.on('error', (err) => {
    logger.error('Engagement poll worker error', { error: err.message });
  });

  logger.info('EngagementPollWorker started');
  return worker;
}
