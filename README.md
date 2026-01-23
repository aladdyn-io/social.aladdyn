# Social Scene - Content Generation Backend V1

AI-powered content generation backend for social media campaigns.

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
# Development
npm run dev

# Production
npm run build
npm start
```

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

- [x] Project structure
- [x] Type definitions
- [x] Main pipeline orchestration
- [x] All module stubs with clear TODOs
- [x] Configuration setup

### 🚧 TODO

- [ ] Implement local Stable Diffusion integration
- [ ] Implement Replicate API integration
- [ ] Implement HuggingFace API integration
- [ ] Database schema validation
- [ ] Save posts to database
- [ ] Error recovery and retries
- [ ] Unit tests
- [ ] Integration tests
- [ ] Rate limiting for APIs
- [ ] Logging system
- [ ] Monitoring/observability

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
