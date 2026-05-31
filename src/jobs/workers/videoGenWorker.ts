/**
 * Video Generation Worker
 *
 * Processes on-demand video generation requests from the VIDEO_GEN queue.
 * Concurrency limited to VIDEO_CONCURRENCY (default: 1) because Kling jobs
 * are long-running (2–5 min each) and we don't want to exhaust API rate limits.
 */

import { Worker, Job } from 'bullmq';
import prisma from '../../lib/prisma';
import { generatePostVideo } from '../../services/onDemandVideoGeneration';
import { redisConnection } from '../redis';
import { QUEUE_NAMES, VideoGenJobData } from '../queues';
import { createLogger } from '../../utils/logger';

const logger = createLogger({ service: 'video-gen-worker' });

async function processVideoGen(job: Job<VideoGenJobData>): Promise<string> {
  const { postId } = job.data;
  logger.info('Generating video', { postId });

  try {
    const videoUrl = await generatePostVideo(postId);
    logger.info('Video generated', { postId, videoUrl });
    return videoUrl;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Video generation failed', {
      postId,
      error: message,
      attempt: String(job.attemptsMade + 1),
    });

    // Record the error on the post without changing its status.
    // Video gen failure ≠ post failure — status stays DRAFT so the user
    // can retry video generation or fall back to image manually.
    await prisma.socialPost
      .update({
        where: { id: postId },
        data: { publishError: `Video gen attempt ${job.attemptsMade + 1}: ${message}` },
      })
      .catch(() => {}); // never block the rethrow

    throw err; // let BullMQ retry (videoGenQueue: 2 attempts, 10s fixed backoff)
  }
}

export function startVideoGenWorker(): Worker<VideoGenJobData> {
  const concurrency = parseInt(process.env.VIDEO_CONCURRENCY || '1', 10);

  const worker = new Worker<VideoGenJobData>(QUEUE_NAMES.VIDEO_GEN, processVideoGen, {
    connection: redisConnection,
    concurrency,
  });

  worker.on('completed', (job) => {
    logger.info('Job completed', { jobId: job.id ?? '' });
  });

  worker.on('failed', (job, err) => {
    logger.error('Job failed', { jobId: job?.id ?? '', error: err.message });
  });

  logger.info('Started', { concurrency: String(concurrency) });
  return worker;
}
