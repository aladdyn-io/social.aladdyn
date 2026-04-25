/**
 * Post Scheduler
 *
 * Polls the DB for APPROVED posts whose scheduledDate is ≤ now + buffer,
 * and enqueues them into the publish queue with a BullMQ delayed job so
 * they fire at the correct scheduledDate/scheduledTime.
 *
 * Runs on a cron-like interval (every minute).
 * Per the hard constraints: max 30 actions/day/account, random delays,
 * no fixed 24/7 cadence — those are enforced at the worker layer.
 */

import { publishQueue } from './queues';
import prisma from '../lib/prisma';
import { createLogger } from '../utils/logger';
import { getStuckPosts } from '../db/database';

const logger = createLogger({ service: 'scheduler' });

const LOOKAHEAD_MINUTES = 5; // enqueue posts up to 5 min before their target time

export async function scheduleUpcomingPosts(): Promise<void> {
  const now = new Date();
  const lookahead = new Date(now.getTime() + LOOKAHEAD_MINUTES * 60 * 1_000);

  // Auto-approve DRAFT posts that have reached (or passed) their scheduled time.
  // This implements "if not approved by posting date, post automatically".
  const draftOverdue = await prisma.socialPost.findMany({
    where: {
      status: 'DRAFT',
      scheduledDate: { lte: lookahead },
      NOT: { contentType: 'written' },
    },
    take: 50,
  });

  if (draftOverdue.length > 0) {
    logger.info('Auto-approving overdue DRAFT posts', { count: String(draftOverdue.length) });
    for (const post of draftOverdue) {
      await prisma.socialPost
        .update({
          where: { id: post.id },
          data: { status: 'APPROVED', approvedAt: new Date() },
        })
        .catch((err) =>
          logger.error('Failed to auto-approve post', {
            postId: post.id,
            error: err instanceof Error ? err.message : String(err),
          })
        );
    }
  }

  // Find APPROVED posts whose scheduled time is within the lookahead window
  // Exclude 'written' contentType — Instagram has no text-only post type
  const posts = await prisma.socialPost.findMany({
    where: {
      status: 'APPROVED',
      scheduledDate: { lte: lookahead },
      NOT: { contentType: 'written' },
    },
    take: 50, // safety cap per tick
  });

  if (posts.length === 0) return;

  logger.info('Enqueueing upcoming posts', { count: String(posts.length) });

  for (const post of posts) {
    const delay = Math.max(0, post.scheduledDate.getTime() - now.getTime());

    // Mark as SCHEDULED immediately to prevent double-enqueue
    await prisma.socialPost.update({
      where: { id: post.id },
      data: { status: 'SCHEDULED' },
    });

    await publishQueue.add(
      `publish-${post.id}`,
      { postId: post.id, campaignId: post.campaignId, platform: post.platform },
      {
        delay,
        jobId: `publish-${post.id}`, // idempotent — won't double-add (no colons — BullMQ disallows them)
      }
    );

    logger.info('Enqueued post', { postId: post.id, platform: post.platform, delayMs: String(delay) });
  }
}

// Posts stuck in PUBLISHING longer than this are likely orphaned (worker died mid-job)
const STUCK_PUBLISHING_THRESHOLD_MIN = 15;
// Posts stuck in SCHEDULED longer than this were never picked up by the worker
const STUCK_SCHEDULED_THRESHOLD_MIN = 30;

/**
 * Finds posts that have been stuck in PUBLISHING or SCHEDULED for too long
 * and resets them to APPROVED so the scheduler re-enqueues them next tick.
 *
 * PUBLISHING > 15 min  — worker likely crashed mid-job
 * SCHEDULED  > 30 min  — BullMQ job was dropped or Redis restarted
 */
async function sweepStuckPosts(): Promise<void> {
  const stuckPublishing = await getStuckPosts(STUCK_PUBLISHING_THRESHOLD_MIN).then((rows) =>
    rows.filter((p) => p.status === 'PUBLISHING')
  );
  const stuckScheduled = await getStuckPosts(STUCK_SCHEDULED_THRESHOLD_MIN).then((rows) =>
    rows.filter((p) => p.status === 'SCHEDULED')
  );

  const allStuck = [...stuckPublishing, ...stuckScheduled];
  if (allStuck.length === 0) return;

  logger.warn('Resetting stuck posts to APPROVED', { count: String(allStuck.length) });

  for (const post of allStuck) {
    const reason =
      post.status === 'PUBLISHING'
        ? `Reset: stuck in PUBLISHING > ${STUCK_PUBLISHING_THRESHOLD_MIN}m`
        : `Reset: stuck in SCHEDULED > ${STUCK_SCHEDULED_THRESHOLD_MIN}m`;

    await prisma.socialPost
      .update({ where: { id: post.id }, data: { status: 'APPROVED', publishError: reason } })
      .catch((err) =>
        logger.error('Failed to reset stuck post', {
          postId: post.id,
          error: err instanceof Error ? err.message : String(err),
        })
      );

    logger.warn('Reset stuck post', { postId: post.id, reason });
  }
}

/**
 * Marks campaigns as COMPLETED when their endDate has passed.
 * Runs every tick — lightweight query with an index on (status, endDate).
 */
async function autoExpireCampaigns(): Promise<void> {
  const now = new Date();

  const result = await prisma.socialCampaign.updateMany({
    where: {
      status: { in: ['ACTIVE', 'READY', 'PAUSED'] },
      endDate: { lt: now },
    },
    data: { status: 'COMPLETED' },
  });

  if (result.count > 0) {
    logger.info('Auto-expired campaigns', { count: String(result.count) });
  }
}

/** Start the scheduler poll loop (called once on server boot) */
export function startScheduler(intervalMs = 60_000): NodeJS.Timeout {
  logger.info('Starting poll loop', { intervalMs: String(intervalMs) });

  const tick = async () => {
    try {
      await autoExpireCampaigns();
    } catch (err) {
      logger.error('autoExpireCampaigns error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      await scheduleUpcomingPosts();
    } catch (err) {
      logger.error('scheduleUpcomingPosts error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      await sweepStuckPosts();
    } catch (err) {
      logger.error('sweepStuckPosts error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Run immediately on start, then on interval
  tick();
  return setInterval(tick, intervalMs);
}
