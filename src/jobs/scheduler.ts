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

const logger = createLogger({ service: 'scheduler' });

const LOOKAHEAD_MINUTES = 5; // enqueue posts up to 5 min before their target time

export async function scheduleUpcomingPosts(): Promise<void> {
  const now = new Date();
  const lookahead = new Date(now.getTime() + LOOKAHEAD_MINUTES * 60 * 1_000);

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

/** Start the scheduler poll loop (called once on server boot) */
export function startScheduler(intervalMs = 60_000): NodeJS.Timeout {
  logger.info('Starting poll loop', { intervalMs: String(intervalMs) });

  const tick = async () => {
    try {
      await scheduleUpcomingPosts();
    } catch (err) {
      logger.error('Poll error', { error: err instanceof Error ? err.message : String(err) });
    }
  };

  // Run immediately on start, then on interval
  tick();
  return setInterval(tick, intervalMs);
}
