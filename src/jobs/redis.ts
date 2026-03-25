/**
 * Shared Redis connection for BullMQ
 *
 * All queues and workers reuse this connection config.
 * BullMQ requires a separate connection per worker (it calls .duplicate() internally).
 */

export const redisConnection = {
  host: (() => {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    try {
      return new URL(url).hostname;
    } catch {
      return 'localhost';
    }
  })(),
  port: (() => {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    try {
      return parseInt(new URL(url).port || '6379', 10);
    } catch {
      return 6379;
    }
  })(),
  maxRetriesPerRequest: null, // Required by BullMQ
};
