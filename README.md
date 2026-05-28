# Social Scene - Content Generation Backend V2

AI-powered content generation backend for social media campaigns with REST API.

> [!IMPORTANT]
> **AI Onboarding & Project Status**: For a complete, high-fidelity transmission of the current architecture, recent major diagnostics (e.g. combined DateTime scheduler, LinkedIn direct publishing, demo.html interactive card inputs), active issues, and pending implementation lists, please refer to the master [PROJECT_STATUS.md](PROJECT_STATUS.md) at the root.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start API server
npm run dev

# Test the API
node simple-test.js
```

Server runs on `http://localhost:3000`

**See [QUICKSTART.md](QUICKSTART.md) and [API_DOCS.md](API_DOCS.md) for details.**

## Architecture

```
┌─────────────────┐
│   Database      │ ← Campaign inputs
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Input Normalizer│ ← Validates & normalizes (NO AI)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│Strategy Generator│ ← LLM generates content strategy
└────────┬────────┘
         │
         ├──────────────────┐
         │                  │
         ▼                  ▼
┌──────────────┐   ┌───────────────┐
│Festival Engine│   │Calendar Gen   │ ← Rule-based scheduling
└──────┬───────┘   └───────┬───────┘
       │                   │
       └─────────┬─────────┘
                 │
                 ▼
         ┌───────────────┐
         │For each post: │
         │               │
         │ 1. Caption Gen│ ← LLM generates caption
         │ 2. Image Gen  │ ← Stable Diffusion
         │ 3. S3 Upload  │ ← AWS S3
         └───────────────┘
                 │
                 ▼
         ┌───────────────┐
         │Final Response │
         └───────────────┘
```

## Project Structure

```
src/
├── index.ts                 # Entry point
├── pipeline.ts              # Main orchestrator
├── types.ts                 # Data contracts
├── db/
│   └── database.ts          # PostgreSQL connector
└── modules/
    ├── inputNormalizer.ts   # Input validation (NO AI)
    ├── strategyGenerator.ts # LLM strategy generation
    ├── festivalEngine.ts    # Festival lookup (NO AI)
    ├── calendarGenerator.ts # Calendar scheduling (NO AI)
    ├── captionGenerator.ts  # LLM caption generation
    ├── imageGenerator.ts    # Stable Diffusion adapter
    └── s3Uploader.ts        # AWS S3 upload
```

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Required configuration:

- **Database**: PostgreSQL connection details
- **LLM**: OpenAI API key (or other provider)
- **AWS**: S3 credentials and bucket name
- **Image Gen**: Choose provider (local/replicate/huggingface)

### 3. Run

```bash
# Development (API Server)
npm run dev

# Production
npm run build
npm start

# CLI mode (original)
npm run dev:cli
```

## API Endpoints

### Health Check

```bash
GET /health
```

### Generate Content

```bash
POST /api/v1/generate-content
Content-Type: application/json

{
  "input": {
    "industry": "Coffee Shop",
    "total_days": 7,
    "frequency_per_week": 2,
    "services": ["Specialty Coffee", "Pastries"],
    "geography": "India"
  }
}
```

See [API_DOCS.md](API_DOCS.md) for complete API reference.

## Module Details

### Input Normalizer

- **AI**: NO
- **Purpose**: Validates and normalizes database input
- **Rules**: Checks required fields, validates formats, computes totals

### Strategy Generator

- **AI**: YES (LLM)
- **Purpose**: Generates content strategy with pillars and brand voice
- **Output**: JSON with target audience, pillars, hashtags

### Festival Engine

- **AI**: NO
- **Purpose**: Fetches relevant Indian festivals for date range
- **Source**: Hardcoded for V1, should use database/API in production

### Calendar Generator

- **AI**: NO
- **Purpose**: Schedules posts with even spacing and festival integration
- **Algorithm**: Rule-based distribution across content pillars

### Caption Generator

- **AI**: YES (LLM)
- **Purpose**: Generates engaging captions with hashtags and CTAs
- **Context**: Uses strategy, pillars, and festival themes

### Image Generator

- **AI**: YES (Stable Diffusion)
- **Purpose**: Generates images using model-agnostic adapter
- **Providers**: Local, Replicate, HuggingFace (configurable)

### S3 Uploader

- **AI**: NO
- **Purpose**: Uploads images to AWS S3 with public access
- **Output**: Public S3 URLs

## Data Contracts

All module interfaces are defined in `types.ts`. Key types:

- `DatabaseInput`: Raw data from database
- `NormalizedInput`: Validated and computed input
- `ContentStrategy`: LLM-generated strategy
- `ContentCalendar`: Scheduled post entries
- `GeneratedPost`: Final post with caption + image
- `PipelineResponse`: Complete output

## Development Status

### ✅ Completed

- [x] Project structure & Type definitions
- [x] Main pipeline orchestration
- [x] Configuration setup & Express REST API server
- [x] API documentation & Error handling middleware
- [x] **Stable Diffusion (Local/sharp) Integration**
- [x] **Replicate API Integration (FLUX schnell)**
- [x] **HuggingFace API Integration (XLabs flux-RealismLora)**
- [x] **DeepAI API Integration (text2img)**
- [x] **Database Schema Validation & PostgreSQL Post Persistency**
- [x] **ONNX-Powered Subject Masking & Foreground Cutout Extraction**
- [x] **Playwright 3D Sandwich Compositor & Google Fonts System**
- [x] **Automated Heuristic Quality Gating (OCR scan, detail variance, color sampler)**
- [x] **Interactive Chronological Content Calendar UI inside Diagnostic Console (demo.html)**
- [x] **Cascade Storage Deletion (MinIO folder purges on campaign/post delete)**
- [x] **Duplicate Topic Prevention (Sequential LLM historical check)**
- [x] **Automatic Orchestrator Re-rolls & Error Recovery**
- [x] **Ultra-Premium Visual Overhaul (rotated cursive Caveat/Pacifico fonts, solid/double-ring checklist badges, high-fashion pill circular arrow CTAs)**

### 🚧 TODO

- [ ] Unit tests & integration tests
- [ ] Rate limiting for public APIs
- [ ] Continuous telemetry dashboard


## Usage Example

```typescript
import { runContentGenerationPipeline } from "./pipeline";

const dbInput = {
  campaign_id: "campaign-123",
  industry: "Fitness",
  total_days: 30,
  frequency_per_week: 3,
  festival_enabled: true,
  logo_url: "https://example.com/logo.png",
  font_style: "Roboto",
  accent_color: "#FF5733",
  base_color: "#1A1A1A",
  services: ["Personal Training", "Nutrition Coaching"],
  geography: "India",
};

const result = await runContentGenerationPipeline(dbInput);

console.log(`Generated ${result.posts.length} posts`);
console.log(`Strategy: ${result.strategy.brandVoice}`);
```

## Error Handling

The pipeline uses custom error types:

- `ValidationError`: Input validation failures (fail fast)
- `AIGenerationError`: LLM failures (retryable)
- `ImageGenerationError`: Image generation failures (retryable)

Individual post failures don't stop the entire pipeline.

## License

ISC
