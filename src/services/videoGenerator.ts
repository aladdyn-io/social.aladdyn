/**
 * Video Generator Service — Kling AI
 *
 * Handles JWT authentication, task creation, polling, and MP4 download
 * for the Kling AI video generation REST API.
 *
 * Environment variables:
 *   KLING_ACCESS_KEY   — required; Kling API access key
 *   KLING_SECRET_KEY   — required; Kling API secret key
 *   KLING_API_BASE_URL — optional; defaults to https://api.klingai.com
 *
 * Usage:
 *   const generator = new KlingVideoGenerator();
 *   const buffer = await generator.generateVideo(prompt, config);
 */

import axios from 'axios';
import * as jwt from 'jsonwebtoken';
import { createLogger } from '../utils/logger';

const logger = createLogger({ service: 'kling-video-generator' });

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VideoConfig {
  aspectRatio: '9:16' | '16:9' | '1:1';
  /** Duration in seconds as a string — Kling API format */
  duration: '5' | '10';
  modelName: 'kling-v1' | 'kling-v1-5';
  mode: 'std' | 'pro';
}

// ── Error classes ─────────────────────────────────────────────────────────────

export class VideoGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoGenerationError';
  }
}

export class VideoTimeoutError extends Error {
  constructor(taskId: string, pollCount: number) {
    super(
      `Kling video task '${taskId}' did not complete after ${pollCount} polls (${pollCount * 5}s)`
    );
    this.name = 'VideoTimeoutError';
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = 'https://api.klingai.com';
const POLL_INTERVAL_MS = 5_000;   // 5 seconds between polls
const MAX_POLLS = 60;              // 60 × 5s = 300s max wait
const JWT_EXPIRY_SECONDS = 1800;  // 30 minutes

const NEGATIVE_PROMPT =
  'text, watermarks, logos, faces, blurry, low quality, distorted, pixelated, nsfw';

// ── JWT helper ────────────────────────────────────────────────────────────────

/**
 * Generates a short-lived HS256 JWT for Kling API authentication.
 * Payload: { iss: accessKey, exp: now+1800, nbf: now-5 }
 */
function generateKlingJWT(accessKey: string, secretKey: string): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    iss: accessKey,
    exp: nowSeconds + JWT_EXPIRY_SECONDS,
    nbf: nowSeconds - 5,
  };
  return jwt.sign(payload, secretKey, { algorithm: 'HS256' });
}

// ── Kling API response types ──────────────────────────────────────────────────

interface KlingCreateTaskResponse {
  code: number;
  message: string;
  data: {
    task_id: string;
    task_status: string;
  };
}

interface KlingPollResponse {
  code: number;
  message: string;
  data: {
    task_id: string;
    task_status: 'submitted' | 'processing' | 'succeed' | 'failed';
    task_status_msg?: string;
    task_result?: {
      videos?: Array<{ url: string; duration: string }>;
    };
  };
}

// ── KlingVideoGenerator ───────────────────────────────────────────────────────

export class KlingVideoGenerator {
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;

  constructor() {
    const accessKey = process.env.KLING_ACCESS_KEY;
    const secretKey = process.env.KLING_SECRET_KEY;

    if (!accessKey || !secretKey) {
      throw new VideoGenerationError(
        'KLING_ACCESS_KEY and KLING_SECRET_KEY environment variables are required for video generation'
      );
    }

    this.accessKey = accessKey;
    this.secretKey = secretKey;
    this.baseUrl = process.env.KLING_API_BASE_URL?.replace(/\/$/, '') ?? DEFAULT_BASE_URL;
  }

  /**
   * Generates a video from a text prompt using the Kling AI API.
   *
   * Flow:
   *   1. Create a video generation task (POST /v1/videos/text2video)
   *   2. Poll task status every 5s until succeed/failed or 300s timeout
   *   3. Download the MP4 bytes from the returned URL
   *
   * @param prompt  - Motion-aware video prompt (50–1000 chars)
   * @param config  - Platform-specific video configuration
   * @returns       Raw MP4 bytes as a Buffer
   * @throws VideoGenerationError on API errors or task failure
   * @throws VideoTimeoutError if the task doesn't complete within 300s
   */
  async generateVideo(prompt: string, config: VideoConfig): Promise<Buffer> {
    const startTime = Date.now();
    logger.info('Starting Kling video generation', {
      aspectRatio: config.aspectRatio,
      duration: config.duration,
      modelName: config.modelName,
      mode: config.mode,
      promptLength: String(prompt.length),
    });

    // Step 1: Create task
    const taskId = await this.createVideoTask(prompt, config);
    logger.info(`Kling task created: ${taskId}`);

    // Step 2: Poll until terminal state
    const videoUrl = await this.pollVideoTask(taskId);
    logger.info(`Kling task succeeded: ${taskId}, downloading from ${videoUrl}`);

    // Step 3: Download MP4 bytes
    const buffer = await this.downloadVideoBytes(videoUrl);

    const latencyMs = Date.now() - startTime;
    logger.info('Kling video generation complete', {
      taskId,
      fileSizeBytes: String(buffer.length),
      latencyMs: String(latencyMs),
    });

    return buffer;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async createVideoTask(prompt: string, config: VideoConfig): Promise<string> {
    const token = generateKlingJWT(this.accessKey, this.secretKey);
    const url = `${this.baseUrl}/v1/videos/text2video`;

    let response: KlingCreateTaskResponse;
    try {
      const res = await axios.post<KlingCreateTaskResponse>(
        url,
        {
          prompt,
          negative_prompt: NEGATIVE_PROMPT,
          model_name: config.modelName,
          mode: config.mode,
          aspect_ratio: config.aspectRatio,
          duration: config.duration,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 30_000,
        }
      );
      response = res.data;
    } catch (err: any) {
      const status = err.response?.status ?? 0;
      const body = JSON.stringify(err.response?.data ?? {});
      throw new VideoGenerationError(
        `Kling API error creating task (HTTP ${status}): ${body}`
      );
    }

    if (response.code !== 0) {
      throw new VideoGenerationError(
        `Kling API rejected task creation (code=${response.code}): ${response.message}`
      );
    }

    return response.data.task_id;
  }

  private async pollVideoTask(taskId: string): Promise<string> {
    const token = generateKlingJWT(this.accessKey, this.secretKey);
    const url = `${this.baseUrl}/v1/videos/text2video/${taskId}`;

    for (let poll = 1; poll <= MAX_POLLS; poll++) {
      await sleep(POLL_INTERVAL_MS);

      let response: KlingPollResponse;
      try {
        // Regenerate JWT every 10 polls to avoid expiry on long jobs
        const currentToken = poll % 10 === 0
          ? generateKlingJWT(this.accessKey, this.secretKey)
          : token;

        const res = await axios.get<KlingPollResponse>(url, {
          headers: { Authorization: `Bearer ${currentToken}` },
          timeout: 15_000,
        });
        response = res.data;
      } catch (err: any) {
        const status = err.response?.status ?? 0;
        const body = JSON.stringify(err.response?.data ?? {});
        throw new VideoGenerationError(
          `Kling API error polling task '${taskId}' (HTTP ${status}): ${body}`
        );
      }

      const { task_status, task_status_msg, task_result } = response.data;

      logger.info(`Kling poll ${poll}/${MAX_POLLS}: task_status=${task_status}`, { taskId });

      if (task_status === 'succeed') {
        const videoUrl = task_result?.videos?.[0]?.url;
        if (!videoUrl) {
          throw new VideoGenerationError(
            `Kling task '${taskId}' succeeded but returned no video URL`
          );
        }
        return videoUrl;
      }

      if (task_status === 'failed') {
        throw new VideoGenerationError(
          `Kling task '${taskId}' failed: ${task_status_msg ?? 'unknown reason'}`
        );
      }

      // 'submitted' | 'processing' → keep polling
    }

    throw new VideoTimeoutError(taskId, MAX_POLLS);
  }

  private async downloadVideoBytes(videoUrl: string): Promise<Buffer> {
    try {
      const res = await axios.get<ArrayBuffer>(videoUrl, {
        responseType: 'arraybuffer',
        timeout: 120_000, // 2 min for large video downloads
      });
      return Buffer.from(res.data);
    } catch (err: any) {
      throw new VideoGenerationError(
        `Failed to download video from '${videoUrl}': ${err.message}`
      );
    }
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
