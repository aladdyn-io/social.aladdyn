/**
 * BullMQ Queue Definitions
 *
 * Central registry for all Social Scene queues.
 * Queues are keyed by name and share a single Redis connection.
 */

import { Queue } from 'bullmq';
import { redisConnection } from './redis';

// ── Queue names ─────────────────────────────────────────────────────────────

export const QUEUE_NAMES = {
  PUBLISH: 'social-publish',
  IMAGE_GEN: 'social-image-gen',
  ENGAGEMENT_POLL: 'social-engagement-poll',
} as const;

// ── Queue instances ──────────────────────────────────────────────────────────

/** Post publishing queue — processes SCHEDULED posts at their target time */
export const publishQueue = new Queue(QUEUE_NAMES.PUBLISH, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});

/** Image generation queue — processes on-demand image requests */
export const imageGenQueue = new Queue(QUEUE_NAMES.IMAGE_GEN, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 5_000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  },
});

/** Engagement poll queue — polls Meta/LinkedIn APIs for post engagement data */
export const engagementPollQueue = new Queue(QUEUE_NAMES.ENGAGEMENT_POLL, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});

// ── Job data types ───────────────────────────────────────────────────────────

export interface PublishJobData {
  postId: string;
  campaignId: string;
  platform: string;
}

export interface ImageGenJobData {
  postId: string;
}

export interface EngagementPollJobData {
  postId: string;
  platformPostId: string;
  platform: string;
  funnelId: string;
  userId: string;
}
