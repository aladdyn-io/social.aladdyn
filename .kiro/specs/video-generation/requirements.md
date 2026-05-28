# Requirements Document

## Introduction

This feature extends the Social Aladdyn TypeScript/Node.js pipeline to generate short-form MP4 videos for social media post slots whose `contentType` is `reel` or `story`. All other content types (`photo`, `carousel`, `written`) continue to use the existing static image path unchanged.

The feature adds a `videoPrompt` field to `SocialPost`, a `VideoConfig` model encoding platform-specific constraints, a `KlingVideoGenerator` that calls the Kling AI REST API, a graceful fallback to the existing `generatePostImage()` path when video generation fails, and a BullMQ-based async queue for background video generation.

---

## Glossary

- **KlingVideoGenerator**: The new service class responsible for JWT auth, task creation, polling, and downloading MP4 bytes from the Kling AI REST API.
- **VideoConfig**: A TypeScript interface encoding platform-specific video constraints: `aspectRatio`, `duration`, `modelName`, `mode`.
- **Video_Content_Type**: A `contentType` value that triggers video generation. The set is: `reel`, `story`.
- **Image_Content_Type**: A `contentType` value that continues to use the existing image generation path. The set is: `photo`, `carousel`, `written`.
- **Video_Fallback**: The behaviour triggered when `KlingVideoGenerator.generateVideo()` fails after all retries: the slot falls back to `generatePostImage()`, and the post is marked with `mediaType = 'image'` and `isFallback = true`.
- **videoPrompt**: A new field on `SocialPost` that stores the motion-aware video prompt generated during the `generatePosts` pipeline stage for `reel` / `story` slots.
- **PLATFORM_VIDEO_CONFIGS**: A lookup table mapping `(platform, contentType)` pairs to `VideoConfig` objects.
- **SocialPost**: The existing Prisma model representing a single scheduled post.

---

## Requirements

### Requirement 1: Content-Type Routing

**User Story:** As a campaign manager, I want reels and stories to automatically produce videos while photos and carousels continue to produce static images, so that each post format gets the right media type without manual configuration.

#### Acceptance Criteria

1. WHEN `POST /api/v1/posts/:postId/generate-video` is called for a post whose `contentType` is `reel` or `story`, THE system SHALL route that post to the `generatePostVideo()` path.
2. WHEN `POST /api/v1/posts/:postId/generate-video` is called for a post whose `contentType` is `photo`, `carousel`, or `written`, THE system SHALL route that post to the existing `generatePostImage()` path unchanged.
3. THE routing function `isVideoContentType(contentType)` SHALL return `true` if and only if `contentType` is `'reel'` or `'story'`, and `false` for all other values including unrecognised strings.

---

### Requirement 2: Video Prompt Generation

**User Story:** As a creative director, I want the pipeline to produce a dedicated motion-aware video prompt for reel and story slots during content generation, so that the Kling API has rich scene and motion instructions.

#### Acceptance Criteria

1. WHEN `generatePosts()` processes a `CalendarItem` whose `contentType` is `reel` or `story`, THE system SHALL call `generateDetailedVideoPrompt()` and store the result in `SocialPost.videoPrompt`.
2. WHEN `generatePosts()` processes a `CalendarItem` whose `contentType` is `photo`, `carousel`, or `written`, THE system SHALL NOT call `generateDetailedVideoPrompt()` and SHALL leave `videoPrompt` as `null`.
3. THE `generateDetailedVideoPrompt()` function SHALL return a string of 50–1000 characters describing scene, motion, camera movement, lighting, pacing, visual style, and mood.
4. THE `generateDetailedVideoPrompt()` function SHALL NOT include brand logos, watermarks, faces, or platform UI elements in the returned prompt.
5. THE `generateDetailedVideoPrompt()` function SHALL fall back to a template prompt if the LLM call fails, consistent with the pattern in `generateDetailedImagePrompt()`.
6. THE `imagePrompt` field SHALL still be generated for all slots including `reel` and `story`, to serve as the fallback still-frame prompt if video generation fails.

---

### Requirement 3: Platform-Specific Video Configuration

**User Story:** As a platform engineer, I want each video post to use a `VideoConfig` derived from its platform and content type, so that generated videos meet platform-specific aspect ratio and duration requirements.

#### Acceptance Criteria

1. THE `deriveVideoConfig(platform, contentType)` function SHALL return a `VideoConfig` using the following lookup table:

   | Platform | Content Type | Aspect Ratio | Duration | Model | Mode |
   |---|---|---|---|---|---|
   | instagram | reel | 9:16 | 10s | kling-v1 | std |
   | instagram | story | 9:16 | 5s | kling-v1 | std |
   | linkedin | reel | 16:9 | 10s | kling-v1 | std |
   | linkedin | story | 9:16 | 5s | kling-v1 | std |
   | whatsapp | reel | 9:16 | 10s | kling-v1 | std |
   | whatsapp | story | 9:16 | 5s | kling-v1 | std |

2. WHERE a `(platform, contentType)` pair is not in the table above, THE `deriveVideoConfig()` function SHALL return the default config: `{ aspectRatio: '9:16', duration: '5', modelName: 'kling-v1', mode: 'std' }`.
3. THE `deriveVideoConfig()` function SHALL never return `undefined` or `null` for any input.

---

### Requirement 4: Kling Video Generation Client

**User Story:** As a backend engineer, I want a `KlingVideoGenerator` class that handles JWT auth, task creation, polling, and MP4 download, so that the rest of the system can treat video generation as a single async call returning a Buffer.

#### Acceptance Criteria

1. THE `KlingVideoGenerator` constructor SHALL throw a `VideoGenerationError` at instantiation time if `KLING_ACCESS_KEY` or `KLING_SECRET_KEY` environment variables are absent.
2. THE `KlingVideoGenerator.generateVideo(prompt, config)` method SHALL: (a) generate a JWT using HS256 with `{ iss: accessKey, exp: now+1800, nbf: now-5 }`, (b) POST to `/v1/videos/text2video` with the prompt and config, (c) poll GET `/v1/videos/text2video/{taskId}` every 5 seconds, (d) download and return the MP4 bytes when status is `succeed`.
3. WHEN the Kling API returns an HTTP 4xx or 5xx response, THE `KlingVideoGenerator` SHALL throw a `VideoGenerationError` that includes the HTTP status code and response body.
4. WHEN the Kling job does not reach a terminal state within 300 seconds (60 polls), THE `KlingVideoGenerator` SHALL throw a `VideoTimeoutError`.
5. WHEN the Kling job reaches status `failed`, THE `KlingVideoGenerator` SHALL throw a `VideoGenerationError` with the `task_status_msg` from the response.
6. THE `KLING_API_BASE_URL` environment variable SHALL override the default base URL `https://api.klingai.com` when set.

---

### Requirement 5: On-Demand Video Generation Service

**User Story:** As a campaign manager, I want to trigger video generation for a specific post on-demand, so that I can generate videos only for the posts I need without re-running the entire pipeline.

#### Acceptance Criteria

1. THE `generatePostVideo(postId, force?)` function SHALL: (a) fetch the post from DB, (b) validate `contentType` is `reel` or `story`, (c) derive `VideoConfig`, (d) call `KlingVideoGenerator.generateVideo()`, (e) upload the MP4 to MinIO, (f) update the post record with `imageUrl`, `imageGenerated = true`, `imageModel = 'kling-v1'`, `mediaType = 'video'`.
2. WHEN `post.imageUrl` is already set and `post.imageGenerated` is `true` and `force` is not `true`, THE `generatePostVideo()` function SHALL return the existing URL without regenerating.
3. WHEN `KlingVideoGenerator.generateVideo()` throws any error, THE `generatePostVideo()` function SHALL catch the error, log a warning, call `generatePostImage(postId, false, force)` as fallback, update the post with `mediaType = 'image'` and `isFallback = true`, and return the image URL.
4. THE `generatePostVideos(postIds)` batch function SHALL process posts sequentially and return a `Map<string, { success, videoUrl?, error? }>`.

---

### Requirement 6: Video Storage

**User Story:** As a storage engineer, I want generated videos stored in MinIO with the correct MIME type, so that the existing media retrieval logic works without modification.

#### Acceptance Criteria

1. THE `uploadBufferToStorage(buffer, 'video/mp4', prefix)` function SHALL upload the MP4 buffer to MinIO with `Content-Type: video/mp4`.
2. THE MinIO object key for a video SHALL follow the pattern `posts/{postId}/video/{timestamp}-{uuid}.mp4`.
3. THE `uploadToMinIO()` internal function SHALL use the `mimeType` parameter for the `Content-Type` header rather than hardcoding `'image/png'`.

---

### Requirement 7: Database Schema Extensions

**User Story:** As a developer, I want the `SocialPost` model to carry video-specific fields, so that the system can distinguish video posts from image posts and track fallback state.

#### Acceptance Criteria

1. THE `SocialPost` Prisma model SHALL include: `videoPrompt String? @db.Text`, `mediaType String @default("image")`, `isFallback Boolean @default(false)`.
2. THE DB migration `009_add_video_fields.sql` SHALL add these columns to `social.social_posts` using `ADD COLUMN IF NOT EXISTS` (additive, no data migration required).
3. THE `savePostsToDB()` function SHALL persist `videoPrompt` to the new DB column when it is present on the `PostItem`.
4. THE `PostItem` TypeScript interface SHALL include an optional `videoPrompt?: string` field.

---

### Requirement 8: BullMQ Queue and Worker

**User Story:** As a backend engineer, I want video generation to run as a background BullMQ job, so that API requests return immediately and long-running Kling jobs don't block the HTTP server.

#### Acceptance Criteria

1. THE `QUEUE_NAMES` constant SHALL include `VIDEO_GEN: 'social-video-gen'`.
2. THE `videoGenQueue` SHALL be configured with `attempts: 2` and `backoff: { type: 'fixed', delay: 10_000 }`.
3. THE `VideoGenJobData` interface SHALL be `{ postId: string }`.
4. THE `videoGenWorker` SHALL call `generatePostVideo(postId)` and on failure record the error on `post.publishError` before rethrowing for BullMQ retry.

---

### Requirement 9: API Endpoints

**User Story:** As a frontend developer, I want REST endpoints for triggering video generation, so that I can build a UI that generates videos for specific posts.

#### Acceptance Criteria

1. THE `POST /api/v1/posts/:postId/generate-video` endpoint SHALL: (a) fetch the post's `contentType`, (b) route to `generatePostVideo()` for `reel`/`story`, (c) route to `generatePostImage()` for all other types, (d) return `{ postId, videoUrl, message, generatedAt }` on success.
2. THE `POST /api/v1/posts/generate-videos/batch` endpoint SHALL accept `{ postIds: string[] }` and return per-post results.
3. WHEN the post is not found, THE endpoint SHALL return HTTP 404.
4. WHEN the DB pool is unavailable, THE endpoint SHALL return HTTP 503.
