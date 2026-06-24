# Aladdyn Social Media Assistant — Project Status & AI Developer Handbook

Last updated: June 2026

---

## 🎯 Executive Project Identity & Purpose

**Aladdyn Social Worker** (internally: **Social Scene Content Generation V2**) automates, schedules, composites, and publishes rich brand-tailored social media campaigns.

Core pillars:
1. **Dynamic Content Pipelines** — LLM-powered strategy, AI topic calendars, parallel caption/prompt engines
2. **On-Demand Generation** — Playwright 3D CSS compositing, ONNX subject masking, OCR quality gates
3. **Robust Posting Pipelines** — BullMQ + PostgreSQL + Redis polling scheduler
4. **Live Publishing Hooks** — LinkedIn chunked binary upload + UGC Share API

---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js, TypeScript (`npx tsx`) |
| API | Express.js |
| Database | PostgreSQL (Neon) via Prisma ORM |
| Queue | BullMQ on Redis (port 6379) |
| Storage | MinIO (S3-compatible local) |
| Compositor | Playwright headless Chromium |
| AI Models | OpenRouter (GPT-4/Claude), Replicate (FLUX), HuggingFace (RealismLora) |
| Publishing | LinkedIn UGC Share API |

---

## 📐 Architecture

```
POST /api/v1/generate-content
  → Input Normalizer
  → LLM Strategy Generator
  → Festival Engine + Calendar Generator
  → Parallel AI Post Generator
  → PostgreSQL

Scheduler (poll every 1 min)
  → getPostTargetDateTime() merges date + time fields
  → Filter by LOOKAHEAD_MINUTES window
  → Enqueue to BullMQ publishQueue

BullMQ Worker
  → LinkedIn credentials present? → Live LinkedIn publisher
  → Otherwise → Mock/Offline publisher
  → Mark post POSTED
```

---

## ✅ Implementation Status

### Phase 1 — Content Generation Pipeline: ✅ Complete
### Phase 2 — Scheduler & Queue: ✅ Complete
### Phase 3 — LinkedIn Publishing: ✅ Complete
### Phase 4 — Image Generation Worker: ✅ Complete
### Phase 5 — Playwright Compositor: ✅ Complete
### Phase 6 — ONNX Subject Masking: ✅ Complete
### Phase 7 — OCR Quality Gates: ✅ Complete
### Phase 8 — Video Generation: 🚧 In Progress (see `.kiro/specs/video-generation/`)

---

## ⚡ Major Bug Fixes (Historical)

### DateTime Scheduler Bug (Fixed)
Prisma maps `scheduledDate` to UTC midnight. `scheduledTime` stored as text. Scheduler previously compared midnight directly → entire campaign published immediately.

**Fix:** `getPostTargetDateTime(scheduledDate, scheduledTime)` reconstructs true absolute datetime, calculates exact BullMQ `delay`.

### LinkedIn Live Integration (Complete)
1. Register asset with LinkedIn media API
2. Binary chunk stream from MinIO/Unsplash
3. UGC Share creation
4. Worker routing via `LINKEDIN_ACCESS_TOKEN` env var presence

---

## 🚧 Current Work: Video Generation

Spec at `.kiro/specs/video-generation/`:
- `requirements.md` — functional requirements
- `design.md` — technical design
- `tasks.md` — implementation task breakdown

---

## ⚙️ Local Dev

```bash
# Start API server
npm run dev

# Run scheduler worker
npm run scheduler

# Run publish worker  
npm run worker

# Required services
redis-server         # port 6379
minio server ~/data  # port 9000
```

---

## 📁 Key Files

| File | Purpose |
|---|---|
| `src/server.ts` | Express REST API gateway |
| `src/jobs/scheduler.ts` | Polling loop + BullMQ enqueue |
| `src/jobs/workers/publishWorker.ts` | Execution + platform routing |
| `src/services/linkedinPublisher.ts` | Live LinkedIn binary upload + UGC share |
| `src/services/htmlRenderer.ts` | Playwright 3D compositor |
| `src/services/subjectMasker.ts` | ONNX subject isolation |
| `src/services/qualityEvaluator.ts` | OCR + color quality gate |
| `demo.html` | Interactive diagnostic dashboard |

---

## 📅 Changelog

### 23/06/2026: Funnel Gating & Premium Subscription Locking
**Engineering / Technical Work:**
- **Funnel Plan Definitions & Seeding**: Realigned the four-tier database funnel templates (`seed-pricing.js`) and aligned onboarding static configurations (`GenieBuildIllustration.tsx`) with specific channel limits (DMs only vs posting vs proactive engagement vs magic chat).
- **Navigation & Interface Lock Overlays**: Gated both the "Social Scene" page and "Magic Chat" page (`overAllChat.tsx`) with premium glassmorphic lock screen overlays, redirecting unauthorized tier users to the upgrade/billing dashboard.
- **Integrations Upgrade CTA Fixes**: Corrected Card CSS styling on the Integrations page (`integrations.tsx`) to remove overlay opacities from children and restore clear, interactive Upgrade Plan buttons.
- **Secure Billing & Verification Pipeline**: Injected plan pre-selection parameter handling (`?upgrade=...`) on the checkout page (`billing.tsx`) and verified that database billing persistence triggers strictly upon Razorpay verification callbacks (`onSuccess`).
- **Dynamic Badge Integrations Progress**: Updated sidebar logic to compute the remaining supported connections count and dynamically display the badge count or hide it when zero slots remain.

**Image Generation Pipeline & Brand Asset Integration:**
- **Branding Asset Context Resolution**: Expanded `GenieContext` schema to support `brandColor`, `brandAccentColor`, and `brandLogo` properties, and refactored the image generation pipeline (`onDemandImageGeneration.ts`) to resolve these parameters from campaign branding or fallback to the live Genie Context.
- **Dynamic Color Propagation**: Wired campaign brand and accent colors directly into the Layout Director, Copy Director, and HTML Renderer, completely eliminating hardcoded default purple accents.
- **Layout-Specific 3D Depth Sandwiching**: Configured ONNX subject cutout masking and 3D depth sandwiching to activate exclusively for `editorial_column` layouts, forcing typography to the foreground for all other archetypes to prevent layout rendering glitches.
- **Saliency CV Gating & Emergency Re-roll**: Implemented a computer vision gating check (`saliencyAnalyzer.ts`) to verify text zone legibility, triggering a single emergency re-roll with strict spatial overrides and body-clearance prompts when background clutter/subject overlap is catastrophically high (>0.70).
- **Social Campaign Activation Alignment**: Expanded `ContentInput` to accept an optional `company_name` and updated campaign forms in the frontend (`social-scene.tsx`) to propagate logo URL, brand colors, and company name directly from the active Genie context.

