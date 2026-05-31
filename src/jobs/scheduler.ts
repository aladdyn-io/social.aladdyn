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

/**
 * Combines a post's scheduled date (midnight) and scheduled time string ("HH:MM")
 * in its specified timezone, resolving the correct absolute UTC Date.
 */
export function getPostTargetDateTime(scheduledDate: Date, scheduledTime: string, timezone = 'Asia/Kolkata'): Date {
  const [hours, minutes] = scheduledTime.split(':').map(Number);
  
  // Construct the target date at the given time in UTC
  const year = scheduledDate.getUTCFullYear();
  const month = scheduledDate.getUTCMonth();
  const day = scheduledDate.getUTCDate();
  
  const utcDate = new Date(Date.UTC(year, month, day, hours, minutes, 0));
  
  try {
    // Format this UTC date in the target timezone to calculate the local offset
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false
    });
    
    const parts = formatter.formatToParts(utcDate);
    const partMap: Record<string, string> = {};
    for (const part of parts) {
      partMap[part.type] = part.value;
    }
    
    // Parse the formatted local parts
    const fYear = parseInt(partMap.year, 10);
    const fMonth = parseInt(partMap.month, 10) - 1; // 0-indexed
    const fDay = parseInt(partMap.day, 10);
    let fHour = parseInt(partMap.hour, 10);
    const fMinute = parseInt(partMap.minute, 10);
    
    // Handle standard midnight representation variations (e.g. 24 hour wrap-around)
    if (fHour === 24) {
      fHour = 0;
    }
    
    // Reconstruct as a UTC timestamp
    const formattedDate = new Date(Date.UTC(fYear, fMonth, fDay, fHour, fMinute, 0));
    
    // The difference is the local timezone offset
    const offsetMs = formattedDate.getTime() - utcDate.getTime();
    
    // The correct UTC time is utcDate - offsetMs
    return new Date(utcDate.getTime() - offsetMs);
  } catch (err) {
    // Robust fallback
    const target = new Date(Date.UTC(year, month, day, hours, minutes, 0));
    if (timezone === 'Asia/Kolkata') {
      return new Date(target.getTime() - 5.5 * 60 * 60 * 1000);
    }
    return target;
  }
}

export async function scheduleUpcomingPosts(): Promise<void> {
  const now = new Date();
  const lookahead = new Date(now.getTime() + LOOKAHEAD_MINUTES * 60 * 1_000);

  // Find APPROVED posts scheduled for any date up to 2 days after now to safely cover all timezone boundaries
  const maxDate = new Date(lookahead.getTime() + 2 * 24 * 60 * 60 * 1000);

  const approvedCandidates = await prisma.socialPost.findMany({
    where: {
      status: 'APPROVED',
      scheduledDate: { lte: maxDate },
    },
    take: 100,
  });

  // Filter candidates that are actually within the lookahead window based on time
  const posts = approvedCandidates.filter((post) => {
    const target = getPostTargetDateTime(post.scheduledDate, post.scheduledTime, post.timezone);
    return target.getTime() <= lookahead.getTime();
  });

  if (posts.length === 0) return;

  logger.info('Enqueueing upcoming posts', { count: String(posts.length) });

  for (const post of posts) {
    const targetDateTime = getPostTargetDateTime(post.scheduledDate, post.scheduledTime, post.timezone);
    const delay = Math.max(0, targetDateTime.getTime() - now.getTime());

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
