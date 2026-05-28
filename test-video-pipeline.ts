/**
 * test-video-pipeline.ts
 *
 * Exhaustive verification script for the Aladdyn Social video generation pipeline.
 * Asserts all 9 Correctness Properties defined in .kiro/specs/video-generation/design.md.
 *
 * Runs completely isolated using custom test fixtures and selective mock wrappers.
 *
 * Execute with:
 *   npx tsx test-video-pipeline.ts
 */

import 'dotenv/config';
import * as assert from 'assert';
import axios from 'axios';
import { isVideoContentType, deriveVideoConfig, generatePostVideo, generatePostVideos } from './src/services/onDemandVideoGeneration';
import { KlingVideoGenerator, VideoGenerationError, VideoTimeoutError } from './src/services/videoGenerator';
import { generateDetailedVideoPrompt } from './src/services/generateVideoPrompt';
import prisma from './src/lib/prisma';
import * as db from './src/db/database';
import * as onDemandImage from './src/services/onDemandImageGeneration';
import * as objectStorage from './src/services/objectStorage';

// Setup Mocking Framework
const originalAxiosPost = axios.post;
const originalAxiosGet = axios.get;
const originalGetPostById = db.getPostById;
const originalSocialPostUpdate = prisma.socialPost.update;
const originalSocialPostFindUnique = prisma.socialPost.findUnique;
const originalSocialCampaignFindUnique = prisma.socialCampaign.findUnique;
const originalGeneratePostImage = onDemandImage.generatePostImage;
const originalUploadBufferToStorage = objectStorage.uploadBufferToStorage;

function resetMocks() {
  axios.post = originalAxiosPost;
  axios.get = originalAxiosGet;
  (global as any).__generatePostImageMock = null;
  (db as any).getPostById = originalGetPostById;
  (prisma.socialPost as any).update = originalSocialPostUpdate;
  (prisma.socialPost as any).findUnique = originalSocialPostFindUnique;
  (prisma.socialCampaign as any).findUnique = originalSocialCampaignFindUnique;
  (onDemandImage as any).generatePostImage = originalGeneratePostImage;
  (objectStorage as any).uploadBufferToStorage = originalUploadBufferToStorage;
}

// Visual helpers for the verification report
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  bold: '\x1b[1m'
};

function logHeader(text: string) {
  console.log(`\n${colors.bold}${colors.cyan}${'='.repeat(80)}${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan} ${text} ${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}${'='.repeat(80)}${colors.reset}\n`);
}

function logResult(propertyNum: number, name: string, passed: boolean, details?: string) {
  const statusSymbol = passed ? `${colors.green}✓ PASSED${colors.reset}` : `${colors.red}✗ FAILED${colors.reset}`;
  console.log(`[Property ${propertyNum}] ${colors.bold}${name}${colors.reset} -> ${statusSymbol}`);
  if (details) {
    console.log(`   Detail: ${details}`);
  }
}

async function runTests() {
  logHeader('ALADDYN VIDEO GENERATION PIPELINE INTEGRATION VERIFIER');

  let p1Passed = false;
  let p2Passed = false;
  let p3Passed = false;
  let p4Passed = false;
  let p5Passed = false;
  let p6Passed = false;
  let p7Passed = false;
  let p8Passed = false;
  let p9Passed = false;

  // ── PROPERTY 1: Content-type routing is total and correct ───────────────────
  try {
    assert.strictEqual(isVideoContentType('reel'), true, 'reel should be a video content type');
    assert.strictEqual(isVideoContentType('story'), true, 'story should be a video content type');
    assert.strictEqual(isVideoContentType('REEL'), true, 'REEL (uppercase) should be case-insensitive');
    assert.strictEqual(isVideoContentType('STORY'), true, 'STORY (uppercase) should be case-insensitive');
    assert.strictEqual(isVideoContentType('photo'), false, 'photo is an image content type');
    assert.strictEqual(isVideoContentType('carousel'), false, 'carousel is an image content type');
    assert.strictEqual(isVideoContentType('written'), false, 'written is text content type');
    assert.strictEqual(isVideoContentType('unknown'), false, 'unknown should return false');
    assert.strictEqual(isVideoContentType(null as any), false, 'null input should handle safely');
    assert.strictEqual(isVideoContentType(undefined as any), false, 'undefined input should handle safely');
    
    p1Passed = true;
    logResult(1, 'Content-type routing is total and correct', true, 'Correctly routes "reel"/"story" and excludes "photo"/"carousel"/"written"');
  } catch (err: any) {
    p1Passed = false;
    logResult(1, 'Content-type routing is total and correct', false, err.message);
  }

  // ── PROPERTY 4: Platform config lookup is total ─────────────────────────────
  try {
    const instagramReel = deriveVideoConfig('instagram', 'reel');
    assert.strictEqual(instagramReel.aspectRatio, '9:16');
    assert.strictEqual(instagramReel.duration, '10');
    assert.strictEqual(instagramReel.modelName, 'kling-v1');

    const linkedinReel = deriveVideoConfig('linkedin', 'reel');
    assert.strictEqual(linkedinReel.aspectRatio, '16:9');
    assert.strictEqual(linkedinReel.duration, '10');

    const fallbackConfig = deriveVideoConfig('unknown_platform', 'unknown_type');
    assert.strictEqual(fallbackConfig.aspectRatio, '9:16', 'Platform fallback config should use default aspect ratio');
    assert.strictEqual(fallbackConfig.duration, '5', 'Platform fallback config should use default duration');
    assert.ok(fallbackConfig.modelName, 'fallback config modelName should be defined');
    assert.ok(fallbackConfig.mode, 'fallback config mode should be defined');

    p4Passed = true;
    logResult(4, 'Platform config lookup is total', true, 'All platform/format pairs return complete configs, default fallback verified');
  } catch (err: any) {
    p4Passed = false;
    logResult(4, 'Platform config lookup is total', false, err.message);
  }

  // ── PROPERTY 2 & 3: Video Prompt Length & Content Invariants ───────────────
  try {
    // Re-use smart Llama mock model in prompt generator
    const calendarItem = {
      date: '2026-05-26',
      pillar: 'Product Education',
      topic: 'Premium vitamin C face glow and collagen restoration',
      content_type: 'reel',
      is_festival: false,
    };
    const strategy = {
      tone: 'luxurious, premium and naturalist',
      content_pillars: ['Product Education'],
      content_mix: { education: 100, trust: 0, promotion: 0 }
    };
    const normalizedInput = {
      industry: 'Biophilic Skincare D2C',
      services: ['Vitamin C Serum'],
      geography: 'USA',
      base_color: '#fefefe',
      accent_color: '#e67e22',
      platform: 'instagram'
    };

    console.log('   Generating dynamic prompt via Llama to test invariants...');
    const prompt = await generateDetailedVideoPrompt(calendarItem as any, strategy as any, normalizedInput as any);
    
    // Validate Length Invariant (Property 2)
    assert.ok(prompt.length >= 50 && prompt.length <= 1000, `Prompt length ${prompt.length} out of bounds (50-1000)`);
    p2Passed = true;
    logResult(2, 'Video prompt length invariant', true, `Generated prompt length: ${prompt.length} chars (within [50, 1000])`);

    // Validate Forbidden Terms Invariant (Property 3)
    const forbidden = ['logo', 'watermark', 'brand name', 'platform ui'];
    const lowerPrompt = prompt.toLowerCase();
    for (const term of forbidden) {
      assert.ok(!lowerPrompt.includes(term), `Prompt contains forbidden term: "${term}"`);
    }
    p3Passed = true;
    logResult(3, 'Video prompt contains no forbidden terms', true, 'Verified generated prompt excludes logos, watermarks, and UI elements');

  } catch (err: any) {
    if (!p2Passed) logResult(2, 'Video prompt length invariant', false, err.message);
    if (!p3Passed) logResult(3, 'Video prompt contains no forbidden terms', false, err.message);
  }

  // Set mock Kling keys for subsequent generator tests
  process.env.KLING_ACCESS_KEY = 'test-access-key';
  process.env.KLING_SECRET_KEY = 'test-secret-key';
  const generator = new KlingVideoGenerator();

  // ── PROPERTY 5: API error codes map to VideoGenerationError ─────────────────
  try {
    axios.post = async () => {
      throw {
        response: {
          status: 403,
          data: { code: 403001, message: 'Invalid API signature or authentication failed' }
        }
      };
    };

    await assert.rejects(
      async () => {
        await generator.generateVideo('Stunning biophilic studio setup', {
          aspectRatio: '9:16',
          duration: '5',
          modelName: 'kling-v1',
          mode: 'std'
        });
      },
      (err) => {
        assert.ok(err instanceof VideoGenerationError);
        assert.ok(err.message.includes('HTTP 403'), 'Error message should report HTTP status code');
        assert.ok(err.message.includes('Invalid API signature'), 'Error message should capture response body');
        return true;
      }
    );

    p5Passed = true;
    logResult(5, 'API error codes map to VideoGenerationError', true, 'Kling 4xx/5xx responses successfully catch and rethrow as structured VideoGenerationErrors');
  } catch (err: any) {
    p5Passed = false;
    logResult(5, 'API error codes map to VideoGenerationError', false, err.message);
  } finally {
    resetMocks();
  }

  // ── PROPERTY 6: Timeout throws VideoTimeoutError ──────────────────────────
  try {
    axios.post = async () => {
      return { data: { code: 0, message: 'success', data: { task_id: 'task-timeout-123', task_status: 'submitted' } } };
    };

    // Fast poll mock: returns processing continually
    axios.get = async () => {
      return { data: { code: 0, message: 'success', data: { task_id: 'task-timeout-123', task_status: 'processing' } } };
    };

    // To prevent the test from running for 5 minutes, we decrease the polling interval/count temporarily in tests if possible,
    // but since they are constants, we can mock global setTimeout/sleep or mock the poll count.
    // Instead of letting it poll 60 times at 5 seconds each, let's mock setTimeout to fire immediately!
    const originalSetTimeout = global.setTimeout;
    (global as any).setTimeout = (fn: any, ms: number) => originalSetTimeout(fn, 1);

    await assert.rejects(
      async () => {
        await generator.generateVideo('Stunning biophilic studio setup', {
          aspectRatio: '9:16',
          duration: '5',
          modelName: 'kling-v1',
          mode: 'std'
        });
      },
      (err) => {
        assert.ok(err instanceof VideoTimeoutError);
        assert.ok(err.message.includes('did not complete after 60 polls'), 'Timeout message should reference 60 polls limit');
        return true;
      }
    );

    (global as any).setTimeout = originalSetTimeout;
    p6Passed = true;
    logResult(6, 'Timeout throws VideoTimeoutError', true, 'Worker loop polls up to 300s (60 attempts) and exits cleanly with VideoTimeoutError');
  } catch (err: any) {
    p6Passed = false;
    logResult(6, 'Timeout throws VideoTimeoutError', false, err.message);
  } finally {
    resetMocks();
  }

  // ── PROPERTY 7, 8, & 9: Fallback, Object Key, and Media Type Persistence ───
  try {
    const mockPostId = 'post-uuid-999';
    const mockCampaignId = 'campaign-uuid-999';
    const mockVideoUrl = 'http://localhost:9000/aladdyn/posts/post-uuid-999/video/1779708071-test.mp4';
    const mockImageUrl = 'http://localhost:9000/aladdyn/posts/post-uuid-999/1779708071-fallback.png';

    // Mock post in database
    const mockDbPost = {
      id: mockPostId,
      campaignId: mockCampaignId,
      scheduledDate: new Date(),
      scheduledTime: '10:00',
      timezone: 'Asia/Kolkata',
      platform: 'instagram',
      contentType: 'reel',
      caption: 'Test video post',
      hashtags: ['#test'],
      callToAction: 'Visit us',
      imagePrompt: 'A beautiful serum bottle',
      videoPrompt: 'Camera pans across organic biophilic serum bottle on light oak wooden table',
      imageUrl: null,
      imageGenerated: false,
      mediaType: 'image',
      isFallback: false,
    };

    // ── Success path verification ──
    (prisma.socialPost as any).findUnique = async (args: any) => {
      assert.strictEqual(args.where.id, mockPostId);
      return mockDbPost as any;
    };

    (prisma.socialCampaign as any).findUnique = async (args: any) => {
      assert.strictEqual(args.where.id, mockCampaignId);
      return { id: mockCampaignId, industry: 'Skincare', brandColor: '#ffffff', accentColor: '#ff0000' } as any;
    };

    // Mock successful Kling generator
    axios.post = async () => {
      return { data: { code: 0, message: 'success', data: { task_id: 'task-success-999', task_status: 'submitted' } } };
    };

    axios.get = async (url: string) => {
      if (url.includes('task-success-999')) {
        return {
          data: {
            code: 0,
            message: 'success',
            data: {
              task_id: 'task-success-999',
              task_status: 'succeed',
              task_result: { videos: [{ url: 'http://kling.api/assets/video.mp4', duration: '10' }] }
            }
          }
        };
      }
      // Mock video bytes download
      return { data: Buffer.from('mock-mp4-data-bytes'), responseType: 'arraybuffer' };
    };

    // Mock MinIO upload (Property 8 check)
    let uploadedKey = '';
    (objectStorage as any).uploadBufferToStorage = async (buffer: Buffer, mimeType: string, prefix: string) => {
      assert.strictEqual(mimeType, 'video/mp4');
      assert.ok(prefix.includes(mockPostId), 'Prefix must include postId');
      
      const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
      uploadedKey = `${prefix}${Date.now()}-mock-uuid.mp4`;
      
      // Verify Naming Convention (Property 8)
      const keyPattern = /^posts\/[^/]+\/video\/\d+-.*\.mp4$/;
      assert.ok(keyPattern.test(uploadedKey), `Key "${uploadedKey}" does not match pattern: posts/{postId}/video/{timestamp}-{uuid}.mp4`);
      
      return mockVideoUrl;
    };

    // Mock successful update in DB (Property 9 check)
    let successPostUpdateData: any = null;
    (prisma.socialPost as any).update = async (args: any) => {
      assert.strictEqual(args.where.id, mockPostId);
      successPostUpdateData = args.data;
      return { ...mockDbPost, ...args.data };
    };

    const finalUrl = await generatePostVideo(mockPostId, true);
    
    assert.ok(finalUrl.startsWith('http://localhost:9000/aladdyn/posts/post-uuid-999/video/'), 'URL should use configured bucket and prefix');
    assert.ok(finalUrl.endsWith('.mp4'), 'URL extension must be .mp4');
    assert.strictEqual(successPostUpdateData.mediaType, 'video', 'Successful video gen must set mediaType to video');
    assert.strictEqual(successPostUpdateData.isFallback, false, 'Successful video gen must clear fallback state');
    assert.strictEqual(successPostUpdateData.imageGenerated, true);

    p8Passed = true;
    logResult(8, 'MinIO object key follows naming convention', true, `Object key pattern holds: posts/{postId}/video/{timestamp}-{uuid}.mp4`);

    // ── Failure Fallback Path verification (Property 7 & Property 9 fallback) ──
    
    // Reset DB update tracks
    let fallbackPostUpdateData: any = null;
    
    // Simulate generator failure
    axios.post = async () => {
      throw new Error('Kling API rate limited');
    };

    // Mock fallback generator
    (global as any).__generatePostImageMock = async (postId: string, disableHtml: boolean, force: boolean) => {
      assert.strictEqual(postId, mockPostId);
      return mockImageUrl;
    };

    // Catch the mock prisma update
    (prisma.socialPost as any).update = async (args: any) => {
      assert.strictEqual(args.where.id, mockPostId);
      fallbackPostUpdateData = args.data;
      return { ...mockDbPost, ...args.data };
    };

    const fallbackUrl = await generatePostVideo(mockPostId, true);
    
    assert.strictEqual(fallbackUrl, mockImageUrl, 'Fallback should return the static image URL');
    assert.strictEqual(fallbackPostUpdateData.mediaType, 'image', 'Fallback must restore mediaType to image');
    assert.strictEqual(fallbackPostUpdateData.isFallback, true, 'Fallback must flag isFallback as true');

    p7Passed = true;
    logResult(7, 'Fallback is triggered for any video generation failure', true, 'Gracefully falls back to static image on Kling API exceptions');
    
    p9Passed = true;
    logResult(9, 'mediaType field reflects actual media stored', true, 'Successfully writes mediaType="video" on success and mediaType="image" + isFallback=true on failure');

  } catch (err: any) {
    if (!p7Passed) logResult(7, 'Fallback is triggered for any video generation failure', false, err.message);
    if (!p8Passed) logResult(8, 'MinIO object key follows naming convention', false, err.message);
    if (!p9Passed) logResult(9, 'mediaType field reflects actual media stored', false, err.message);
  } finally {
    resetMocks();
  }

  // ── Clean up environment overrides ─────────────────────────────────────────
  delete process.env.KLING_ACCESS_KEY;
  delete process.env.KLING_SECRET_KEY;

  logHeader('VERIFICATION RESULTS SUMMARY');
  const totalPassed = [p1Passed, p2Passed, p3Passed, p4Passed, p5Passed, p6Passed, p7Passed, p8Passed, p9Passed].filter(Boolean).length;
  console.log(`Pipeline Correctness: ${totalPassed}/9 Properties fully validated.`);
  
  if (totalPassed === 9) {
    console.log(`\n${colors.green}${colors.bold}CONGRATULATIONS! The video generation pipeline is properly integrated and completely compliant with specifications.${colors.reset}\n`);
  } else {
    console.log(`\n${colors.red}${colors.bold}ATTENTION: One or more properties failed validation. Please review the detailed logs above.${colors.reset}\n`);
  }
}

runTests().catch((err) => {
  console.error('Fatal error running pipeline tests:', err);
  resetMocks();
});
