# Implementation Plan: Video Generation

## Overview

Extend the Social Aladdyn pipeline to generate short-form MP4 videos for `reel` and `story` post slots using the Kling AI REST API. The implementation follows the dependency order: DB schema first, then storage fix, then the Kling client, then prompt generation, then pipeline integration, then persistence, then the orchestration service, then the BullMQ queue/worker, then API endpoints, and finally property-based tests for all nine correctness properties.

## Tasks

- [x] 1. DB migration and Prisma schema extension
  - [x] 1.1 Write migration file `009_add_video_fields.sql`
    - Create `migrations/009_add_video_fields.sql` with `ALTER TABLE social.social_posts ADD COLUMN IF NOT EXISTS video_prompt TEXT, ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'image', ADD COLUMN IF NOT EXISTS is_fallback BOOLEAN NOT NULL DEFAULT false`
    - Purely additive — no data migration required
    - _Requirements: 7.1, 7.2_
  - [x] 1.2 Update `schema.prisma` with new `SocialPost` fields
    - Add `videoPrompt String? @db.Text`, `mediaType String @default("image")`, `isFallback Boolean @default(false)` to the `SocialPost` model
    - Run `npx prisma generate` to regenerate the Prisma client
    - _Requirements: 7.1_

- [x] 2. Fix MIME-type handling in `objectStorage.ts`
  - [x] 2.1 Parameterise `uploadToMinIO()` with a `mimeType` argument
    - Change the `Content-Type` header from the hardcoded `'image/png'` to the `mimeType` parameter
    - Derive the file extension from `mimeType`: `'video/mp4'` → `'.mp4'`, otherwise `'.png'`
    - Update `uploadBufferToStorage()` to pass its `mimeType` argument through to `uploadToMinIO()`
    - _Requirements: 6.1, 6.3_
  - [ ]* 2.2 Write unit tests for `uploadToMinIO` MIME-type routing
    - Mock the MinIO client; assert `Content-Type` header equals the supplied `mimeType`
    - Assert object key ends with `.mp4` when `mimeType` is `'video/mp4'` and `.png` otherwise
    - _Requirements: 6.1, 6.3_

- [ ] 3. Implement `KlingVideoGenerator` in `src/services/videoGenerator.ts`
  - [x] 3.1 Define `VideoConfig`, `VideoGenerationError`, and `VideoTimeoutError`
    - Export `VideoConfig` interface: `{ aspectRatio: '9:16' | '16:9' | '1:1'; duration: '5' | '10'; modelName: 'kling-v1' | 'kling-v1-5'; mode: 'std' | 'pro' }`
    - Export `VideoGenerationError extends Error` and `VideoTimeoutError extends Error`
    - _Requirements: 4.1, 4.3, 4.4_
  - [x] 3.2 Implement `KlingVideoGenerator` constructor and JWT generation
    - Constructor reads `KLING_ACCESS_KEY` and `KLING_SECRET_KEY`; throws `VideoGenerationError` if either is absent
    - `generateKlingJWT()` private method: HS256, payload `{ iss: accessKey, exp: now+1800, nbf: now-5 }`, secret `KLING_SECRET_KEY`
    - Respect `KLING_API_BASE_URL` env var, defaulting to `https://api.klingai.com`
    - _Requirements: 4.1, 4.6_
  - [x] 3.3 Implement `generateVideo(prompt, config)` — task creation and polling
    - POST to `/v1/videos/text2video` with prompt, config fields, and `negative_prompt`
    - Throw `VideoGenerationError` (including HTTP status and body) on any 4xx/5xx response
    - Poll GET `/v1/videos/text2video/{taskId}` every 5 seconds, up to 60 polls (300 s)
    - On `succeed`: fetch the video URL from `data.task_result.videos[0].url`, download bytes, return `Buffer`
    - On `failed`: throw `VideoGenerationError` with `task_status_msg`
    - On timeout (60 polls exhausted): throw `VideoTimeoutError`
    - _Requirements: 4.2, 4.3, 4.4, 4.5_
  - [ ]* 3.4 Write property test — Property 5: API error codes map to `VideoGenerationError`
    - **Property 5: API error codes map to VideoGenerationError**
    - Use `fast-check` to generate arbitrary HTTP status codes in range 400–599
    - Mock the HTTP client to return each status; assert `generateVideo()` throws `VideoGenerationError` containing the status code
    - **Validates: Requirements 4.3**
  - [ ]* 3.5 Write property test — Property 6: Timeout throws `VideoTimeoutError`
    - **Property 6: Timeout throws VideoTimeoutError**
    - Use `fast-check` to generate poll counts ≥ 60 with no terminal state
    - Assert `generateVideo()` throws `VideoTimeoutError` after exactly 60 polls
    - **Validates: Requirements 4.4**

- [x] 4. Implement `generateDetailedVideoPrompt` in `src/services/generateVideoPrompt.ts`
  - [x] 4.1 Create `src/services/generateVideoPrompt.ts` mirroring `generateImagePrompt.ts`
    - Export `generateDetailedVideoPrompt(calendarItem, strategy, normalized): Promise<string>`
    - Call `callLlm()` with `llama-3.3-70b-versatile`; system prompt must forbid logos, watermarks, faces, platform UI
    - Include platform-aware aspect-ratio hint: `9:16` for instagram/story/reel, `16:9` for linkedin
    - On LLM failure, fall back to a template prompt (same pattern as `generateDetailedImagePrompt`)
    - _Requirements: 2.3, 2.4, 2.5_
  - [ ]* 4.2 Write property test — Property 2: Video prompt length invariant
    - **Property 2: Video prompt length invariant**
    - Use `fast-check` to generate arbitrary `CalendarItem` inputs
    - Assert `generateDetailedVideoPrompt()` always returns a string with `length >= 50 && length <= 1000`
    - **Validates: Requirements 2.3**
  - [ ]* 4.3 Write property test — Property 3: Video prompt contains no forbidden terms
    - **Property 3: Video prompt contains no forbidden terms**
    - Use `fast-check` to generate arbitrary inputs
    - Assert the returned string does not contain `'logo'`, `'watermark'`, `'brand name'`, or `'platform UI'` (case-insensitive)
    - **Validates: Requirements 2.4**

- [ ] 5. Extend `generatePosts.ts` and `types/content.ts` with `videoPrompt`
  - [x] 5.1 Add `videoPrompt?: string` to the `PostItem` interface in `types/content.ts`
    - Add optional field `videoPrompt?: string` to `PostItem`
    - _Requirements: 7.4_
  - [-] 5.2 Route `reel`/`story` slots to `generateDetailedVideoPrompt` in `generatePosts.ts`
    - Import `generateDetailedVideoPrompt` from `./generateVideoPrompt`
    - For each `CalendarItem`, detect `isVideo = ['reel', 'story'].includes(entry.content_type)`
    - In the parallel `Promise.all` block, add `isVideo ? generateDetailedVideoPrompt(...) : Promise.resolve(undefined)` as the third promise
    - Assign the resolved value to `post.videoPrompt`; leave `imagePrompt` generation unchanged for all slots
    - _Requirements: 2.1, 2.2, 2.6_
  - [ ]* 5.3 Write unit tests for `generatePosts` routing logic
    - Assert `videoPrompt` is populated for `reel` and `story` entries
    - Assert `videoPrompt` is `undefined`/`null` for `photo`, `carousel`, `written` entries
    - Assert `imagePrompt` is always populated regardless of content type
    - _Requirements: 2.1, 2.2, 2.6_

- [ ] 6. Persist `videoPrompt` in `database.ts`
  - [ ] 6.1 Update `savePostsToDB()` to write `videoPrompt` to the DB
    - In the Prisma `create`/`upsert` call inside `savePostsToDB()`, include `videoPrompt: post.videoPrompt ?? null`
    - _Requirements: 7.3_
  - [ ]* 6.2 Write unit tests for `savePostsToDB` with `videoPrompt`
    - Mock Prisma; assert `videoPrompt` is passed through when present and `null` when absent
    - _Requirements: 7.3_

- [~] 7. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Implement `onDemandVideoGeneration.ts`
  - [~] 8.1 Implement `deriveVideoConfig(platform, contentType)` with `PLATFORM_VIDEO_CONFIGS` lookup
    - Define `PLATFORM_VIDEO_CONFIGS` constant for instagram/linkedin/whatsapp × reel/story
    - Define `DEFAULT_VIDEO_CONFIG: VideoConfig = { aspectRatio: '9:16', duration: '5', modelName: 'kling-v1', mode: 'std' }`
    - `deriveVideoConfig` returns the matching entry or `DEFAULT_VIDEO_CONFIG`; never returns `undefined` or `null`
    - Export `isVideoContentType(contentType: string): boolean` returning `true` iff value is `'reel'` or `'story'`
    - _Requirements: 1.3, 3.1, 3.2, 3.3_
  - [ ]* 8.2 Write property test — Property 1: Content-type routing is total and correct
    - **Property 1: Content-type routing is total and correct**
    - Use `fast-check` to generate arbitrary strings
    - Assert `isVideoContentType(s)` returns `true` iff `s === 'reel' || s === 'story'`
    - **Validates: Requirements 1.1, 1.2, 1.3**
  - [ ]* 8.3 Write property test — Property 4: Platform config lookup is total
    - **Property 4: Platform config lookup is total**
    - Use `fast-check` to generate arbitrary `platform` and `contentType` strings
    - Assert `deriveVideoConfig(p, c)` always returns an object with all four fields (`aspectRatio`, `duration`, `modelName`, `mode`) defined and non-null
    - **Validates: Requirements 3.1, 3.2, 3.3**
  - [~] 8.4 Implement `generatePostVideo(postId, force?)` orchestration
    - Fetch post from DB; throw `AppError` (404) if not found; throw `AppError` (400) if `contentType` is not `reel`/`story`
    - Short-circuit if `post.imageUrl && post.imageGenerated && !force`
    - Call `deriveVideoConfig`, use `post.videoPrompt` or call `generateDetailedVideoPrompt()` on-the-fly
    - Call `new KlingVideoGenerator().generateVideo(prompt, config)` → `Buffer`
    - Call `uploadBufferToStorage(buffer, 'video/mp4', \`posts/${postId}/video/\`)` → URL
    - Update post: `imageUrl`, `imageGenerated = true`, `imageModel = 'kling-v1'`, `mediaType = 'video'`
    - Wrap steps 5–8 in try/catch: on error, call `generatePostImage(postId, false, force)`, update `mediaType = 'image'` and `isFallback = true`, return image URL
    - _Requirements: 5.1, 5.2, 5.3_
  - [ ]* 8.5 Write property test — Property 7: Fallback triggered for any video generation failure
    - **Property 7: Fallback is triggered for any video generation failure**
    - Use `fast-check` to generate arbitrary error types thrown by `KlingVideoGenerator.generateVideo`
    - Mock `generatePostImage` and Prisma update; assert both are called and `isFallback = true` is written
    - **Validates: Requirements 5.1, 5.3**
  - [ ]* 8.6 Write property test — Property 8: MinIO object key follows naming convention
    - **Property 8: MinIO object key follows naming convention**
    - Use `fast-check` to generate arbitrary `postId` strings
    - Assert the returned object key matches the regex `^posts\/[^/]+\/video\/\d+-[0-9a-f-]+\.mp4$`
    - **Validates: Requirements 6.2**
  - [ ]* 8.7 Write property test — Property 9: `mediaType` field reflects actual media stored
    - **Property 9: mediaType field reflects actual media stored**
    - Use `fast-check` to generate success and failure scenarios
    - On success path: assert Prisma update is called with `mediaType: 'video'` and `isFallback` not set to `true`
    - On fallback path: assert Prisma update is called with `mediaType: 'image'` and `isFallback: true`
    - **Validates: Requirements 7.1, 5.3**
  - [~] 8.8 Implement `generatePostVideos(postIds)` batch function
    - Iterate `postIds` sequentially (not in parallel) using a `for...of` loop
    - Catch per-post errors and record them in the result map without aborting the batch
    - Return `Map<string, { success: boolean; videoUrl?: string; error?: string }>`
    - _Requirements: 5.4_

- [ ] 9. Add `videoGenQueue` and `videoGenWorker`
  - [~] 9.1 Add `VIDEO_GEN` queue to `src/jobs/queues.ts`
    - Add `VIDEO_GEN: 'social-video-gen'` to `QUEUE_NAMES`
    - Export `videoGenQueue` with `attempts: 2`, `backoff: { type: 'fixed', delay: 10_000 }`, `removeOnComplete: { count: 200 }`, `removeOnFail: { count: 100 }`
    - Export `VideoGenJobData` interface: `{ postId: string }`
    - _Requirements: 8.1, 8.2, 8.3_
  - [~] 9.2 Create `src/jobs/workers/videoGenWorker.ts`
    - Mirror `imageGenWorker.ts` structure
    - Worker calls `generatePostVideo(data.postId)`
    - On failure, update `post.publishError` with the error message before rethrowing so BullMQ can retry
    - Export `startVideoGenWorker(): Worker<VideoGenJobData>`
    - _Requirements: 8.4_
  - [ ]* 9.3 Write unit tests for `videoGenWorker` error recording
    - Mock `generatePostVideo` to throw; assert `post.publishError` is updated and the error is rethrown
    - _Requirements: 8.4_

- [ ] 10. Add API endpoints to `src/server.ts`
  - [~] 10.1 Implement `POST /api/v1/posts/:postId/generate-video`
    - Fetch `contentType` from DB; return 404 if post not found; return 503 if DB pool unavailable
    - Route to `generatePostVideo(postId, true)` for `reel`/`story`, else `generatePostImage(postId, false, true)`
    - Return `{ success: true, data: { postId, videoUrl, message, generatedAt } }`
    - _Requirements: 9.1, 9.3, 9.4_
  - [~] 10.2 Implement `POST /api/v1/posts/generate-videos/batch`
    - Accept `{ postIds: string[] }` in request body
    - Call `generatePostVideos(postIds)` and map results to array
    - Return `{ success: true, data: { results } }`
    - _Requirements: 9.2_
  - [ ]* 10.3 Write integration tests for both endpoints
    - Test 404 response when post does not exist
    - Test 503 response when DB pool is unavailable
    - Test routing: `reel`/`story` calls `generatePostVideo`, others call `generatePostImage`
    - Test batch endpoint returns per-post results
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [~] 11. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use `fast-check` (already a common choice in TypeScript projects); install with `npm install --save-dev fast-check` if not present
- The `imagePrompt` field continues to be generated for all slots including `reel`/`story` — it serves as the fallback still-frame prompt
- LinkedIn video publishing is a known limitation: the publisher will fall back to text-only at publish time (future enhancement)
- Checkpoints ensure incremental validation at logical boundaries

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "3.2", "5.1"] },
    { "id": 3, "tasks": ["3.3", "4.1"] },
    { "id": 4, "tasks": ["3.4", "3.5", "4.2", "4.3", "5.2"] },
    { "id": 5, "tasks": ["5.3", "6.1"] },
    { "id": 6, "tasks": ["6.2", "8.1"] },
    { "id": 7, "tasks": ["8.2", "8.3", "8.4"] },
    { "id": 8, "tasks": ["8.5", "8.6", "8.7", "8.8"] },
    { "id": 9, "tasks": ["9.1"] },
    { "id": 10, "tasks": ["9.2", "10.1", "10.2"] },
    { "id": 11, "tasks": ["9.3", "10.3"] }
  ]
}
```
