/**
 * capture_render.ts
 *
 * Utility to render and capture the HTML compositor output for a specific post,
 * saving the screenshot directly to disk for visual inspection.
 * Unlike the standard pipeline, this does NOT upload to MinIO or update the database.
 *
 * Usage:
 *   npx tsx src/services/capture_render.ts <postId> [outputPath]
 *
 * Example:
 *   npx tsx src/services/capture_render.ts 159829bb-a60a-4032-bd6c-5104307bec4d ./preview.png
 */

import fs from 'fs';
import path from 'path';
import prisma from '../lib/prisma';
import { fetchGenieContext } from './genieContext';
import { renderAdComposite } from './htmlRenderer';
import { generateAdCopyBlueprint } from './copyDirector';
import { generateLayoutBlueprint } from './layoutDirector';
import { generateImageFromPrompt } from './imageGenerator';
import { analyzeLocalColors } from './colorAnalyzer';
import { createLogger } from '../utils/logger';

const logger = createLogger({ service: 'capture-render' });

const POST_ID   = process.argv[2];
const OUT_PATH  = process.argv[3] || path.resolve(__dirname, `../../preview_${POST_ID?.slice(0, 8) || 'output'}.png`);

async function main() {
  if (!POST_ID) {
    console.error('❌ Usage: npx tsx src/services/capture_render.ts <postId> [outputPath]');
    process.exit(1);
  }

  logger.info(`Starting capture render for post: ${POST_ID}`);
  logger.info(`Output will be saved to: ${OUT_PATH}`);

  // 1. Fetch post
  const post = await prisma.socialPost.findUnique({
    where: { id: POST_ID },
    include: {
      campaign: {
        select: {
          id: true,
          name: true,
          companyName: true,
          brandLogo: true,
          brandColor: true,
          accentColor: true,
          industry: true,
          geography: true,
          tone: true,
          funnelId: true,
          services: true,
          strategy: { select: { ctaStyle: true, tone: true } },
        },
      },
    },
  });

  if (!post) {
    logger.error(`Post not found: ${POST_ID}`);
    process.exit(1);
  }

  if (!post.imagePrompt) {
    logger.error('Post has no imagePrompt set. Cannot generate background scene.');
    process.exit(1);
  }

  const campaign = post.campaign;

  // 2. Resolve brand context (same logic as main pipeline)
  let brandLogoUrl    = campaign?.brandLogo || '';
  let brandName       = campaign?.companyName || '';
  let resolvedBrandColor  = campaign?.brandColor || '#764ba2';
  let resolvedAccentColor = campaign?.accentColor || '#667eea';

  if (campaign?.funnelId && (!brandLogoUrl || !brandName || resolvedBrandColor === '#764ba2' || resolvedAccentColor === '#667eea')) {
    const genieCtx = await fetchGenieContext(campaign.funnelId).catch(() => null);
    if (genieCtx) {
      if (!brandLogoUrl && genieCtx.brandLogo)                 brandLogoUrl = genieCtx.brandLogo;
      if (!brandName && genieCtx.companyName)                  brandName = genieCtx.companyName;
      if (resolvedBrandColor === '#764ba2' && genieCtx.brandColor)         resolvedBrandColor = genieCtx.brandColor;
      if (resolvedAccentColor === '#667eea' && genieCtx.brandAccentColor)  resolvedAccentColor = genieCtx.brandAccentColor;
    }
  }
  if (!brandName) brandName = campaign?.name || campaign?.industry || 'Aladdyn Social';

  logger.info(`Brand context resolved — Logo: ${brandLogoUrl || '(none)'}, Name: ${brandName}, Color: ${resolvedBrandColor}, Accent: ${resolvedAccentColor}`);

  // 3. Generate background scene
  logger.info('Generating background scene from image prompt...');
  const baseImage = await generateImageFromPrompt(post.imagePrompt);
  logger.info(`✓ Background generated (${(baseImage.imageBuffer.length / 1024).toFixed(1)} KB)`);

  // 4. Copy Director pass
  logger.info('Running Copy Director...');
  let copyBlueprint: any;
  try {
    copyBlueprint = await generateAdCopyBlueprint({
      topic: post.topic || undefined,
      caption: post.caption || undefined,
      contentPillar: post.contentPillar || undefined,
      brandName,
      industry: campaign?.industry || 'Lifestyle',
      tone: campaign?.tone || undefined,
    });
    logger.info(`✓ Copy blueprint: ${copyBlueprint.primaryHeadline}`);
  } catch (e: any) {
    logger.warn(`Copy Director failed: ${e.message}`);
  }

  // 5. Color analysis
  logger.info('Analysing local color contrast...');
  const colorMetrics = await analyzeLocalColors(baseImage.imageBuffer, 'top_left', 8);
  logger.info(`✓ Color analysis: dark=${colorMetrics.isDarkBg}, avg=${colorMetrics.averageColorHex}`);

  // 6. Layout Director pass
  logger.info('Running Layout Director...');
  let layoutBlueprint: any;
  try {
    layoutBlueprint = await generateLayoutBlueprint({
      imagePrompt: post.imagePrompt,
      industry: campaign?.industry || 'Lifestyle',
      services: campaign?.services || [],
      baseColor: resolvedBrandColor,
      accentColor: resolvedAccentColor || undefined,
      geography: campaign?.geography || undefined,
      safestQuadrant: 'top_left',
      contrastMetrics: {
        isDarkBg: colorMetrics.isDarkBg,
        headlineColor: colorMetrics.headlineColor,
        subtitleColor: colorMetrics.subtitleColor,
        averageColorHex: colorMetrics.averageColorHex,
        averageColorName: colorMetrics.averageColorName,
      },
      canvasDimensions: { width: 1080, height: 1080 },
      slideIndex: undefined,
      feedback: undefined,
      copyBlueprint: copyBlueprint,
    });
    logger.info(`✓ Layout archetype: ${layoutBlueprint?.designArchetype}`);
  } catch (e: any) {
    logger.warn(`Layout Director failed: ${e.message}`);
  }

  // 7. Composite render
  logger.info('Compositing via Playwright HTML Renderer...');
  const compositePng = await renderAdComposite({
    baseImageBuffer: baseImage.imageBuffer,
    brandLogoUrl,
    brandName,
    templateStyle: layoutBlueprint?.designArchetype || 'glass',
    subjectMaskUrl: undefined,
    headline: copyBlueprint?.primaryHeadline || post.topic || 'Special Spotlight',
    subtitle: copyBlueprint?.secondarySubtitle || '',
    cta: post.callToAction || 'Learn More',
    quadrant: 'top_left',
    colors: colorMetrics,
    width: 1080,
    height: 1080,
    brandColor: resolvedBrandColor || undefined,
    accentColor: resolvedAccentColor || undefined,
    geography: campaign?.geography || undefined,
    industry: campaign?.industry || undefined,
    topic: post.topic || undefined,
    copyElements: copyBlueprint?.elements || [],
    layoutBlueprint: layoutBlueprint || { layoutType: 'classic' },
  });

  // 8. Save to disk
  fs.writeFileSync(OUT_PATH, compositePng);
  logger.info(`\n✅ Preview saved to: ${OUT_PATH}`);
  logger.info(`   Size: ${(compositePng.length / 1024).toFixed(1)} KB`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  prisma.$disconnect();
  process.exit(1);
});
