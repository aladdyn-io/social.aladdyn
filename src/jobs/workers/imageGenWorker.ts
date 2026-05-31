/**
 * Image Generation Worker
 *
 * Processes on-demand image generation requests from the queue.
 * Concurrency limited to IMAGE_CONCURRENCY (default: 3) to avoid
 * overloading Replicate API.
 */

import { Worker, Job } from 'bullmq';
import prisma from '../../lib/prisma';
import { generatePostImage } from '../../services/onDemandImageGeneration';
import { redisConnection } from '../redis';
import { QUEUE_NAMES, ImageGenJobData } from '../queues';
import { createLogger } from '../../utils/logger';

const logger = createLogger({ service: 'image-gen-worker' });

async function processImageGen(job: Job<ImageGenJobData>): Promise<string> {
  const { postId } = job.data;
  logger.info('Generating image', { postId });

  try {
    const imageUrl = await generatePostImage(postId);
    logger.info('Image generated', { postId, imageUrl });
    return imageUrl;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Image generation failed', {
      postId,
      error: message,
      attempt: String(job.attemptsMade + 1),
    });

    // Record the error on the post without changing its status.
    // Image gen failure ≠ post failure — status stays DRAFT so the user
    // can retry image generation or upload media manually.
    await prisma.socialPost
      .update({
        where: { id: postId },
        data: { publishError: `Image gen attempt ${job.attemptsMade + 1}: ${message}` },
      })
      .catch(() => {}); // never block the rethrow

    throw err; // let BullMQ retry (imageGenQueue: 2 attempts, 5s fixed backoff)
  }
}

export function startImageGenWorker(): Worker<ImageGenJobData> {
  const concurrency = parseInt(process.env.IMAGE_CONCURRENCY || '1', 10);

  const worker = new Worker<ImageGenJobData>(QUEUE_NAMES.IMAGE_GEN, processImageGen, {
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
