/**
 * Image Generation Worker
 *
 * Processes on-demand image generation requests from the queue.
 * Concurrency limited to IMAGE_CONCURRENCY (default: 3) to avoid
 * overloading Replicate API.
 */

import { Worker, Job } from 'bullmq';
import { generatePostImage } from '../../services/onDemandImageGeneration';
import { redisConnection } from '../redis';
import { QUEUE_NAMES, ImageGenJobData } from '../queues';

async function processImageGen(job: Job<ImageGenJobData>): Promise<string> {
  const { postId } = job.data;
  console.log(`[ImageGenWorker] Generating image for post ${postId}...`);
  const imageUrl = await generatePostImage(postId);
  console.log(`[ImageGenWorker] ✓ Done: ${imageUrl}`);
  return imageUrl;
}

export function startImageGenWorker(): Worker<ImageGenJobData> {
  const concurrency = parseInt(process.env.IMAGE_CONCURRENCY || '3', 10);

  const worker = new Worker<ImageGenJobData>(QUEUE_NAMES.IMAGE_GEN, processImageGen, {
    connection: redisConnection,
    concurrency,
  });

  worker.on('completed', (job) => {
    console.log(`[ImageGenWorker] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[ImageGenWorker] Job ${job?.id} failed:`, err.message);
  });

  console.log(`[ImageGenWorker] Started (concurrency: ${concurrency})`);
  return worker;
}
