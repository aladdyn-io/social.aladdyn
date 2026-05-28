# Design Document: Video Generation

## Overview

This feature extends the Social Aladdyn TypeScript/Node.js pipeline to generate short-form MP4 videos for social media post slots whose `contentType` is `reel` or `story`. All other content types (`photo`, `carousel`, `written`) continue to use the existing static image path unchanged.

The design introduces three new service files, one new BullMQ worker, two new API endpoints, a Prisma schema migration, and targeted modifications to four existing files. The Kling AI REST API is the initial video provider, accessed via a JWT-authenticated polling workflow. A graceful fallback to the existing `generatePostImage()` path ensures campaign runs always complete even when the video API is unavailable.

---

## Architecture

### End-to-End Flow

```
POST /api/v1/posts/:postId/generate-video
        │
        ▼
  contentType reel/story? ──yes──► generatePostVideo()
        │                                │
        no                               ▼
        │                    Derive VideoConfig (platform lookup)
        ▼                               │
generatePostImage()                     ▼
  (existing path)          generateDetailedVideoPrompt() via LLM
                                        │
                                        ▼
                           KlingVideoGenerator.generateVideo()
                            ├── generateKlingJWT()
                            ├── POST /v1/videos/text2video
                            ├── poll GET every 5s up to 300s
                            └── download MP4 bytes
                                        │
                              success? ─┤─ failure?
                                        │         │
                                        ▼         ▼
                           uploadBufferToStorage  generatePostImage() fallback
                           (video/mp4)            isFallback = true
                                        │
                                        ▼
                           Update post: imageUrl, mediaType=video,
                                        imageGenerated=true
```

### Pipeline Integration

The `generatePosts` stage already runs in the content pipeline and stores `imagePrompt` for every post. With this feature:

- For `reel` / `story` slots: `generatePosts` additionally calls `generateDetailedVideoPrompt()` and stores the result in the new `videoPrompt` DB column.
- The `imagePrompt` is still generated for all slots (including reel/story) to serve as the fallback still-frame prompt.
- Video generation itself is **on-demand** — triggered by the new API endpoint, not during the pipeline run.

---

## Components

### New Files

#### `src/services/videoGenerator.ts`

Core Kling API client.

```typescript
export interface VideoConfig {
  aspectRatio: '9:16' | '16:9' | '1:1';
  duration: '5' | '10';
  modelName: 'kling-v1' | 'kling-v1-5';
  mode: 'std' | 'pro';
}

export class VideoGenerationError extends Error {}
export class VideoTimeoutError extends Error {}

export class KlingVideoGenerator {
  constructor(); // throws VideoGenerationError if env vars missing
  generateVideo(prompt: string, config: VideoConfig): Promise<Buffer>;
}
```

**JWT generation** (uses `jsonwebtoken` already in package.json):
- Algorithm: HS256
- Payload: `{ iss: KLING_ACCESS_KEY, exp: now + 1800, nbf: now - 5 }`
- Secret: `KLING_SECRET_KEY`

**Polling**: GET `/v1/videos/text2video/{taskId}` every 5s, up to 300s.
- `succeed` → return `data.task_result.videos[0].url`
- `failed` → throw `VideoGenerationError` with `task_status_msg`
- timeout → throw `VideoTimeoutError`

**Env vars**:
- `KLING_ACCESS_KEY` — required
- `KLING_SECRET_KEY` — required
- `KLING_API_BASE_URL` — optional, defaults to `https://api.klingai.com`

---

#### `src/services/generateVideoPrompt.ts`

LLM-based video prompt generator. Mirrors `generateImagePrompt.ts`.

```typescript
export async function generateDetailedVideoPrompt(
  calendarItem: CalendarItem,
  strategy: Strategy,
  normalized: NormalizedInput
): Promise<string>;
```

- Uses `callLlm()` with `llama-3.3-70b-versatile`
- Returns 50–1000 char string: scene, motion, camera, lighting, pacing, mood
- NO text, logos, watermarks, faces, platform UI
- Platform-aware: 9:16 hint for instagram/story/reel; 16:9 for linkedin
- Falls back to template prompt on LLM failure

---

#### `src/services/onDemandVideoGeneration.ts`

Orchestrates on-demand video generation.

```typescript
export async function generatePostVideo(postId: string, force?: boolean): Promise<string>;
export async function generatePostVideos(postIds: string[]): Promise<Map<string, { success: boolean; videoUrl?: string; error?: string }>>;
```

**`generatePostVideo` workflow**:
1. Fetch post from DB; validate `contentType` is `reel` or `story`
2. If `post.imageUrl && post.imageGenerated && !force` → return existing URL
3. Fetch campaign branding from DB
4. `deriveVideoConfig(post.platform, post.contentType)` → `VideoConfig`
5. Use `post.videoPrompt` if set, else call `generateDetailedVideoPrompt()` on-the-fly
6. `new KlingVideoGenerator().generateVideo(prompt, config)` → `Buffer`
7. `uploadBufferToStorage(buffer, 'video/mp4', \`posts/${postId}/video/\`)` → URL
8. Update post: `imageUrl`, `imageGenerated = true`, `imageModel = 'kling-v1'`, `mediaType = 'video'`
9. Return URL

**Fallback** (wraps step 6–8 in try/catch):
```typescript
} catch (videoErr) {
  logger.warn('Video generation failed, falling back to static image', { postId, error: videoErr.message });
  const imageUrl = await generatePostImage(postId, false, force);
  await prisma.socialPost.update({ where: { id: postId }, data: { mediaType: 'image', isFallback: true } });
  return imageUrl;
}
```

**Platform config lookup table**:
```typescript
const PLATFORM_VIDEO_CONFIGS = {
  instagram: {
    reel:  { aspectRatio: '9:16', duration: '10', modelName: 'kling-v1', mode: 'std' },
    story: { aspectRatio: '9:16', duration: '5',  modelName: 'kling-v1', mode: 'std' },
  },
  linkedin: {
    reel:  { aspectRatio: '16:9', duration: '10', modelName: 'kling-v1', mode: 'std' },
    story: { aspectRatio: '9:16', duration: '5',  modelName: 'kling-v1', mode: 'std' },
  },
  whatsapp: {
    reel:  { aspectRatio: '9:16', duration: '10', modelName: 'kling-v1', mode: 'std' },
    story: { aspectRatio: '9:16', duration: '5',  modelName: 'kling-v1', mode: 'std' },
  },
};
const DEFAULT_VIDEO_CONFIG: VideoConfig = { aspectRatio: '9:16', duration: '5', modelName: 'kling-v1', mode: 'std' };
```

---

#### `src/jobs/workers/videoGenWorker.ts`

BullMQ worker. Mirrors `imageGenWorker.ts`.

```typescript
export function startVideoGenWorker(): Worker<VideoGenJobData>;
```

---

### Modified Files

#### `src/jobs/queues.ts`

```typescript
export const QUEUE_NAMES = {
  PUBLISH: 'social-publish',
  IMAGE_GEN: 'social-image-gen',
  VIDEO_GEN: 'social-video-gen',        // NEW
  ENGAGEMENT_POLL: 'social-engagement-poll',
} as const;

export const videoGenQueue = new Queue(QUEUE_NAMES.VIDEO_GEN, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 10_000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  },
});

export interface VideoGenJobData { postId: string; }
```

---

#### `src/services/generatePosts.ts`

For `reel` / `story` slots, the parallel generation block becomes:

```typescript
const isVideo = ['reel', 'story'].includes(entry.content_type);

const [caption, detailedPrompt, videoPrompt] = await Promise.all([
  generateCaption(entry, strategy, input, websiteContext),
  generateDetailedImagePrompt(entry, strategy, input),          // always (fallback)
  isVideo ? generateDetailedVideoPrompt(entry, strategy, input) : Promise.resolve(undefined),
]);

const post: PostItem = {
  // ...existing fields...
  detailedImagePrompt: detailedPrompt,
  videoPrompt: videoPrompt ?? undefined,
  // ...
};
```

`PostItem` gains `videoPrompt?: string`. `savePostsToDB()` persists it.

---

#### `src/server.ts`

```typescript
// POST /api/v1/posts/:postId/generate-video
app.post('/api/v1/posts/:postId/generate-video', requireAuth, asyncHandler(async (req, res) => {
  const { postId } = req.params;
  const post = await prisma.socialPost.findUnique({ where: { id: postId }, select: { contentType: true } });
  if (!post) throw new AppError(ApiErrorCode.CAMPAIGN_NOT_FOUND, 'Post not found', 404);

  const isVideo = ['reel', 'story'].includes(post.contentType);
  const { generatePostVideo } = await import('./services/onDemandVideoGeneration');
  const { generatePostImage } = await import('./services/onDemandImageGeneration');

  const url = isVideo
    ? await generatePostVideo(postId, true)
    : await generatePostImage(postId, false, true);

  res.json({ success: true, data: { postId, videoUrl: url, generatedAt: new Date().toISOString() } });
}));

// POST /api/v1/posts/generate-videos/batch
app.post('/api/v1/posts/generate-videos/batch', requireAuth, asyncHandler(async (req, res) => {
  const { postIds } = req.body;
  const { generatePostVideos } = await import('./services/onDemandVideoGeneration');
  const resultsMap = await generatePostVideos(postIds);
  const results = Array.from(resultsMap.entries()).map(([postId, r]) => ({ postId, ...r }));
  res.json({ success: true, data: { results } });
}));
```

---

#### `src/services/objectStorage.ts`

`uploadToMinIO()` currently hardcodes `'Content-Type': 'image/png'`. Fix:

```typescript
async function uploadToMinIO(image: ImageGenerationResult, prefix: string = 'posts/', mimeType: string = 'image/png'): Promise<string> {
  // ...
  await minioClient.putObject(bucketName, objectKey, image.imageBuffer, image.imageBuffer.length, {
    'Content-Type': mimeType,   // was hardcoded 'image/png'
    'x-amz-acl': 'public-read',
  });
  // object key extension: use mimeType to pick ext
  const ext = mimeType === 'video/mp4' ? 'mp4' : 'png';
  const objectKey = `${prefix}${timestamp}-${uniqueId}.${ext}`;
  // ...
}
```

`uploadBufferToStorage()` passes its `mimeType` arg through to `uploadToMinIO`.

---

## DB Schema

### Prisma (`schema.prisma`)

```prisma
model SocialPost {
  // ... existing fields ...

  // Video lifecycle (NEW)
  videoPrompt  String?  @db.Text
  mediaType    String   @default("image")
  isFallback   Boolean  @default(false)
}
```

### Migration `009_add_video_fields.sql`

```sql
ALTER TABLE social.social_posts
  ADD COLUMN IF NOT EXISTS video_prompt  TEXT,
  ADD COLUMN IF NOT EXISTS media_type    TEXT NOT NULL DEFAULT 'image',
  ADD COLUMN IF NOT EXISTS is_fallback   BOOLEAN NOT NULL DEFAULT false;
```

Purely additive — existing rows default to `media_type = 'image'`, `is_fallback = false`.

---

## Kling API Reference

### Create Task

```
POST https://api.klingai.com/v1/videos/text2video
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "prompt": "...",
  "negative_prompt": "text, watermarks, logos, faces, blurry, low quality",
  "model_name": "kling-v1",
  "mode": "std",
  "aspect_ratio": "9:16",
  "duration": "10"
}

Response: { "data": { "task_id": "abc123", "task_status": "submitted" } }
```

### Poll Status

```
GET https://api.klingai.com/v1/videos/text2video/{task_id}
Authorization: Bearer <jwt>

Response (success):
{
  "data": {
    "task_status": "succeed",
    "task_result": { "videos": [{ "url": "https://...", "duration": "10" }] }
  }
}
```

---

## Correctness Properties

### Property 1: Content-type routing is total and correct
`isVideoContentType(contentType)` returns `true` iff `contentType` is `'reel'` or `'story'`, `false` for all other values.
**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Video prompt length invariant
`generateDetailedVideoPrompt()` returns a string of 50–1000 characters (inclusive) after sanitization.
**Validates: Requirements 2.3**

### Property 3: Video prompt contains no forbidden terms
Generated `videoPrompt` strings do not contain: `'logo'`, `'watermark'`, `'brand name'`, `'platform UI'`.
**Validates: Requirements 2.4**

### Property 4: Platform config lookup is total
`deriveVideoConfig(platform, contentType)` returns a `VideoConfig` with all four fields populated for any string inputs.
**Validates: Requirements 3.1, 3.2, 3.3**

### Property 5: API error codes map to VideoGenerationError
For any HTTP status 400–599 from Kling, `KlingVideoGenerator` throws `VideoGenerationError` including the status code.
**Validates: Requirements 4.3**

### Property 6: Timeout throws VideoTimeoutError
If 60 polls complete without a terminal state, `KlingVideoGenerator` throws `VideoTimeoutError`.
**Validates: Requirements 4.4**

### Property 7: Fallback is triggered for any video generation failure
If `KlingVideoGenerator.generateVideo()` throws, `generatePostVideo()` invokes `generatePostImage()` and sets `isFallback = true`.
**Validates: Requirements 5.1, 5.3**

### Property 8: MinIO object key follows naming convention
Object key for video uploads matches `posts/{postId}/video/{timestamp}-{uuid}.mp4`.
**Validates: Requirements 6.2**

### Property 9: mediaType field reflects actual media stored
After successful video generation: `post.mediaType === 'video'`. After fallback: `post.mediaType === 'image'` and `post.isFallback === true`.
**Validates: Requirements 7.1, 5.3**

---

## Known Limitations

**LinkedIn video**: `linkedinPublisher.ts` only supports image upload via `registerUpload`. LinkedIn `reel` posts will have a video stored in MinIO but the publisher will fall back to text-only at publish time. LinkedIn video support is a future enhancement.
