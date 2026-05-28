# 🚀 Implementation Roadmap: Pipeline Modernization

This document provides the step-by-step engineering roadmap to implement the resumable state machine and premium Playwright layout compositor in the `social.aladdyn` TypeScript backend.

---

## Phase 1: Database Setup & Prisma Migration

First, update the database to support state-tracking.

### Step 1.1: Update `prisma/schema.prisma`
Add the `PipelineRun` and `PipelineStageOutput` models at the end of the schema file:

```prisma
enum PipelineStatus {
  PENDING
  RUNNING
  PAUSED
  COMPLETED
  FAILED
}

enum StageStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
  OVERRIDDEN
}

model PipelineRun {
  id            String               @id @default(uuid())
  campaignId    String               @unique
  campaign      SocialCampaign       @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  status        PipelineStatus       @default(PENDING)
  brandInput    Json
  createdAt     DateTime             @default(now())
  startedAt     DateTime?
  completedAt   DateTime?
  stages        PipelineStageOutput[]

  @@map("pipeline_runs")
  @@schema("social")
}

model PipelineStageOutput {
  id            String         @id @default(uuid())
  runId         String
  pipelineRun   PipelineRun    @relation(fields: [runId], references: [id], onDelete: Cascade)
  stageName     String
  status        StageStatus    @default(PENDING)
  outputJson    Json?
  errorMessage  String?        @db.Text
  attemptCount  Int            @default(0)
  completedAt   DateTime?

  @@unique([runId, stageName])
  @@map("pipeline_stage_outputs")
  @@schema("social")
}
```

### Step 1.2: Run Database Migration
Execute the migration command to apply changes to PostgreSQL:
```bash
npx prisma migrate dev --name add_resumable_pipeline_tracking
```

---

## Phase 2: Implement the Resumable Stage Orchestrator

Create the orchestrator service to handle incremental execution, retries, and manual overrides.

### Step 2.1: Create `src/pipeline/orchestrator.ts`
Create this file to define the execution loop:

```typescript
import prisma from '../lib/prisma';
import { runContentPipeline } from './runContentPipeline';
import { createLogger } from '../utils/logger';

const logger = createLogger({ service: 'pipeline-orchestrator' });

export const STAGE_ORDER = [
  'genieContext',
  'normalizeInput',
  'generateStrategy',
  'generateCalendar',
  'generatePosts'
];

export class CampaignPipelineOrchestrator {
  /**
   * Initializes a pipeline run in the database with all stages pending
   */
  static async initializeRun(campaignId: string, brandInput: any) {
    return await prisma.$transaction(async (tx) => {
      const run = await tx.pipelineRun.create({
        data: {
          campaignId,
          status: 'PENDING',
          brandInput,
        }
      });

      const stageData = STAGE_ORDER.map(stageName => ({
        runId: run.id,
        stageName,
        status: 'PENDING' as const,
      }));

      await tx.pipelineStageOutput.createMany({ data: stageData });
      return run;
    });
  }

  /**
   * Executes or resumes a campaign run from the first pending/failed stage
   */
  static async executeRun(runId: string) {
    const run = await prisma.pipelineRun.findUnique({
      where: { id: runId },
      include: { stages: { orderBy: { stageName: 'asc' } } }
    });

    if (!run) throw new Error(`Pipeline run not found: ${runId}`);
    if (run.status === 'RUNNING') {
      logger.warn('Pipeline run is already running', { runId });
      return;
    }

    // Update run status to RUNNING
    await prisma.pipelineRun.update({
      where: { id: runId },
      data: { status: 'RUNNING', startedAt: new Date() }
    });

    // Find the first stage that needs execution
    const sortedStages = STAGE_ORDER.map(name => run.stages.find(s => s.stageName === name)!);
    
    try {
      for (const stage of sortedStages) {
        if (stage.status === 'COMPLETED' || stage.status === 'OVERRIDDEN') {
          logger.info(`Skipping completed/overridden stage: ${stage.stageName}`, { runId });
          continue;
        }

        // Execute the stage with exponential backoff retry logic
        await this.executeStageWithRetry(runId, stage.stageName);
      }

      // Mark pipeline run COMPLETED
      await prisma.pipelineRun.update({
        where: { id: runId },
        data: { status: 'COMPLETED', completedAt: new Date() }
      });
      logger.info('Pipeline execution successfully completed', { runId });

    } catch (error: any) {
      await prisma.pipelineRun.update({
        where: { id: runId },
        data: { status: 'FAILED' }
      });
      logger.error('Pipeline run execution aborted due to error', { runId, error: error.message });
    }
  }

  /**
   * Executes a single stage with a maximum of 3 retry attempts
   */
  private static async executeStageWithRetry(runId: string, stageName: string) {
    let attempt = 0;
    const maxAttempts = 3;

    while (attempt < maxAttempts) {
      attempt++;
      logger.info(`Running stage ${stageName} (Attempt ${attempt}/${maxAttempts})`);
      
      // Update stage status to RUNNING
      await prisma.pipelineStageOutput.update({
        where: { runId_stageName: { runId, stageName } },
        data: { status: 'RUNNING', attemptCount: attempt }
      });

      try {
        const output = await this.runStageLogic(runId, stageName);

        // Update stage to COMPLETED
        await prisma.pipelineStageOutput.update({
          where: { runId_stageName: { runId, stageName } },
          data: {
            status: 'COMPLETED',
            outputJson: output,
            errorMessage: null,
            completedAt: new Date()
          }
        });
        return;

      } catch (err: any) {
        logger.error(`Error in stage ${stageName}: ${err.message}`);
        
        if (attempt >= maxAttempts) {
          await prisma.pipelineStageOutput.update({
            where: { runId_stageName: { runId, stageName } },
            data: { status: 'FAILED', errorMessage: err.message }
          });
          throw err;
        }

        // Exponential backoff wait (1s, 2s, 4s)
        const waitTime = Math.pow(2, attempt - 1) * 1000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  /**
   * Dispatches the correct service logic for each stage
   */
  private static async runStageLogic(runId: string, stageName: string): Promise<any> {
    const run = await prisma.pipelineRun.findUnique({
      where: { id: runId },
      include: { stages: true }
    });
    const inputs = run!.brandInput as any;

    switch (stageName) {
      case 'genieContext':
        const { fetchGenieContext } = await import('../services/genieContext');
        return await fetchGenieContext(inputs.funnelId || 'direct');
      
      case 'normalizeInput':
        const { normalizeInput } = await import('../services/normalizeInput');
        return normalizeInput(inputs);

      case 'generateStrategy':
        const genieOutput = run!.stages.find(s => s.stageName === 'genieContext')?.outputJson;
        const { generateStrategy } = await import('../services/generateStrategy');
        return await generateStrategy(inputs, genieOutput);

      case 'generateCalendar':
        const strategy = run!.stages.find(s => s.stageName === 'generateStrategy')?.outputJson;
        const { generateCalendar } = await import('../services/generateCalendar');
        return await generateCalendar(inputs, strategy, [], inputs.campaignId);

      case 'generatePosts':
        const calendar = run!.stages.find(s => s.stageName === 'generateCalendar')?.outputJson;
        const strategyObj = run!.stages.find(s => s.stageName === 'generateStrategy')?.outputJson;
        const { generatePosts } = await import('../services/generatePosts');
        return await generatePosts(calendar, inputs, strategyObj);

      default:
        throw new Error(`Unknown stage name: ${stageName}`);
    }
  }

  /**
   * Applies an interactive user override to a stage, invalidating downstream stages
   */
  static async applyOverride(runId: string, stageName: string, outputJson: any) {
    const stageIndex = STAGE_ORDER.indexOf(stageName);
    if (stageIndex === -1) throw new Error(`Invalid stage name: ${stageName}`);

    const downstreamStages = STAGE_ORDER.slice(stageIndex + 1);

    await prisma.$transaction(async (tx) => {
      // 1. Update target stage to OVERRIDDEN
      await tx.pipelineStageOutput.update({
        where: { runId_stageName: { runId, stageName } },
        data: {
          status: 'OVERRIDDEN',
          outputJson,
          errorMessage: null,
          completedAt: new Date()
        }
      });

      // 2. Invalidate all downstream stages to PENDING
      await tx.pipelineStageOutput.updateMany({
        where: {
          runId,
          stageName: { in: downstreamStages }
        },
        data: {
          status: 'PENDING',
          outputJson: null,
          errorMessage: null,
          completedAt: null,
          attemptCount: 0
        }
      });

      // 3. Mark pipeline run as PAUSED
      await tx.pipelineRun.update({
        where: { id: runId },
        data: { status: 'PAUSED' }
      });
    });

    logger.info(`Override applied to ${stageName}. Downstream stages invalidated.`, { runId, downstreamStages });
  }
}
```

---

## Phase 3: Implement Playwright HTML Compositor

Add sharp-based saliency color checks and rendering composite logic in Node.js.

### Step 3.1: Install Dependencies
```bash
npm install playwright sharp
npx playwright install chromium
```

### Step 3.2: Create Saliency & Local Color Services
Create `src/services/colorAnalyzer.ts` to perform localized quadrant relative luminance calculations:

```typescript
import sharp from 'sharp';

interface ColorMetrics {
  headline_color: string;
  subtitle_color: string;
  is_dark_bg: boolean;
  bg_opacity_override: number;
}

export async function analyzeLocalColors(
  imageBuffer: Buffer,
  quadrant: string,
  inset: number
): Promise<ColorMetrics> {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const width = metadata.width || 1024;
  const height = metadata.height || 1024;

  // 1. Calculate bounding box of quadrant
  let left = 0, top = 0, boxWidth = Math.floor(width / 2), boxHeight = Math.floor(height / 2);
  const offset = Math.floor((width * inset) / 100);

  if (quadrant.includes('right')) left = Math.floor(width / 2);
  if (quadrant.includes('bottom')) top = Math.floor(height / 2);

  // Crop quadrant area
  const croppedBuffer = await image
    .extract({ left, top, width: boxWidth, height: boxHeight })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = croppedBuffer.data;
  let totalLuminance = 0;
  let pixelCount = pixels.length / 3;

  // 2. Compute Relative Luminance (sRGB standard)
  for (let i = 0; i < pixels.length; i += 3) {
    const r = pixels[i] / 255;
    const g = pixels[i + 1] / 255;
    const b = pixels[i + 2] / 255;
    
    // Linearize values
    const rL = r <= 0.04045 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
    const gL = g <= 0.04045 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
    const bL = b <= 0.04045 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
    
    totalLuminance += 0.2126 * rL + 0.7152 * gL + 0.0722 * bL;
  }

  const avgLuminance = totalLuminance / pixelCount;
  const isDark = avgLuminance < 0.45;

  // Calculate pixel variance/clutter to adjust frosted-glass backplate opacity
  let varianceSum = 0;
  for (let i = 0; i < pixels.length; i += 3) {
    const r = pixels[i] / 255;
    const g = pixels[i + 1] / 255;
    const b = pixels[i + 2] / 255;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    varianceSum += Math.pow(lum - avgLuminance, 2);
  }
  const stdDev = Math.sqrt(varianceSum / pixelCount);

  return {
    headline_color: isDark ? '#FFFFFF' : '#111111',
    subtitle_color: isDark ? '#E5E5E5' : '#444444',
    is_dark_bg: isDark,
    bg_opacity_override: stdDev > 0.2 ? Math.max(0.4, Math.min(0.85, stdDev * 2.5)) : 0.0
  };
}
```

### Step 3.3: Create Playwright HTML Compositor
Create `src/services/htmlRenderer.ts` to perform multi-layered Z-Index rendering:

```typescript
import { chromium } from 'playwright';
import { createLogger } from '../utils/logger';

const logger = createLogger({ service: 'html-renderer' });

export async function renderAdComposite(
  baseImageBase64: string,
  brandLogoUrl: string,
  headline: string,
  subtitle: string,
  cta: string,
  quadrant: string,
  colors: any,
  width: number,
  height: number
): Promise<Buffer> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Set explicit viewport resolution
  await page.setViewportSize({ width, height });

  // Map quadrant names to CSS flex alignment classes
  let verticalAlign = 'items-start';
  let horizontalAlign = 'justify-start';

  if (quadrant.includes('bottom')) verticalAlign = 'items-end';
  if (quadrant.includes('right')) horizontalAlign = 'justify-end';

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&display=swap" rel="stylesheet">
      <style>
        body { font-family: 'Montserrat', sans-serif; }
      </style>
    </head>
    <body class="w-full h-full m-0 p-0 relative overflow-hidden" style="width: ${width}px; height: ${height}px;">
      <!-- Z-Index 0: Background Base Image -->
      <img src="data:image/png;base64,${baseImageBase64}" class="w-full h-full object-cover absolute top-0 left-0 z-0" />

      <!-- Z-Index 1 & 2: Composite Overlay & Typography -->
      <div class="w-full h-full absolute top-0 left-0 z-10 p-12 flex ${verticalAlign} ${horizontalAlign}">
        <div class="max-w-[480px] p-8 rounded-2xl flex flex-col gap-4 backdrop-blur-md transition-all duration-300" 
             style="background-color: rgba(${colors.is_dark_bg ? '17,17,17' : '255,255,255'}, ${colors.bg_opacity_override || 0.4});">
          
          <!-- Brand Logo Header -->
          <div class="flex items-center gap-3">
            <img src="${brandLogoUrl}" class="w-8 h-8 rounded-full object-contain" />
            <span class="text-sm font-bold uppercase tracking-wider" style="color: ${colors.headline_color};">Aladdyn Ad</span>
          </div>

          <!-- Headline Copy -->
          <h1 class="text-3xl font-bold leading-tight" style="color: ${colors.headline_color};">
            ${headline}
          </h1>

          <!-- Subtitle Description -->
          <p class="text-base font-medium leading-relaxed" style="color: ${colors.subtitle_color};">
            ${subtitle}
          </p>

          <!-- Dynamic Call To Action Callout Button -->
          <button class="mt-2 py-3 px-6 rounded-lg text-sm font-bold self-start shadow-md uppercase tracking-wider"
                  style="background-color: ${colors.is_dark_bg ? '#FFFFFF' : '#111111'}; color: ${colors.is_dark_bg ? '#111111' : '#FFFFFF'};">
            ${cta}
          </button>
        </div>
      </div>
    </body>
    </html>
  `;

  await page.setContent(htmlContent);
  await page.waitForLoadState('networkidle');

  // Compile high-fidelity screenshot
  const screenshotBuffer = await page.screenshot({ type: 'png', fullPage: true });
  await browser.close();

  return screenshotBuffer;
}
```

---

## Phase 4: Integrate inside Express API Routes

Open `src/server.ts` and add the pipeline controls and the upgraded on-demand image compositor.

### Step 4.1: Register Orchestrator Routes
Add these endpoints in `src/server.ts`:

```typescript
import { CampaignPipelineOrchestrator } from './pipeline/orchestrator';

/**
 * GET /api/v1/campaigns/:campaignId/pipeline-run
 * Returns current status of stages and serialized inputs
 */
app.get('/api/v1/campaigns/:campaignId/pipeline-run', requireAuth, asyncHandler(async (req, res) => {
  const { campaignId } = req.params;
  const run = await prisma.pipelineRun.findUnique({
    where: { campaignId },
    include: { stages: { orderBy: { stageName: 'asc' } } }
  });

  if (!run) {
    return res.status(404).json({ success: false, message: 'Pipeline run not found' });
  }

  res.json({ success: true, data: run });
}));

/**
 * POST /api/v1/campaigns/:campaignId/stages/:stageName/override
 * Applies human override to a stage, dropping all downstream values
 */
app.post('/api/v1/campaigns/:campaignId/stages/:stageName/override', requireAuth, asyncHandler(async (req, res) => {
  const { campaignId, stageName } = req.params;
  const { outputJson } = req.body;

  const run = await prisma.pipelineRun.findUnique({ where: { campaignId } });
  if (!run) return res.status(404).json({ success: false, message: 'Pipeline run not found' });

  await CampaignPipelineOrchestrator.applyOverride(run.id, stageName, outputJson);
  res.json({ success: true, message: `Successfully overrode stage: ${stageName}` });
}));

/**
 * POST /api/v1/campaigns/:campaignId/pipeline-run/resume
 * Triggers resumption of execution from the first pending stage
 */
app.post('/api/v1/campaigns/:campaignId/pipeline-run/resume', requireAuth, asyncHandler(async (req, res) => {
  const { campaignId } = req.params;
  const run = await prisma.pipelineRun.findUnique({ where: { campaignId } });
  if (!run) return res.status(404).json({ success: false, message: 'Pipeline run not found' });

  // Spawn non-blocking execution background task
  CampaignPipelineOrchestrator.executeRun(run.id).catch(err => {
    console.error('Async run task execution failed:', err);
  });

  res.json({ success: true, message: 'Pipeline run resumed in the background.' });
}));
```

---

## Phase 5: Verification & Verification Checklist

### Automated Unit Testing Setup
Create a Jest mock test under `src/__tests__/compositor.test.ts`:
```typescript
import { analyzeLocalColors } from '../services/colorAnalyzer';

describe('Contrast Solver Math Heuristic', () => {
  it('should resolve to high-contrast white text for a dark sampled buffer', async () => {
    // Generate solid black 100x100 buffer
    const mockImage = Buffer.alloc(100 * 100 * 3, 0); // All values 0 (dark)
    const metrics = await analyzeLocalColors(mockImage, 'top-left', 8);
    expect(metrics.headline_color).toBe('#FFFFFF');
    expect(metrics.is_dark_bg).toBe(true);
  });
});
```

To run the automated tests:
```bash
npm run test src/__tests__/compositor.test.ts
```
