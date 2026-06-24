/**
 * On-Demand Image Generation Service
 *
 * Generates an image for a specific post using its stored detailed prompt,
 * and composites a premium DTC-grade ad creative using saliency quadrant calculations,
 * relative contrast legibility solvers, and Playwright headless browser rendering.
 *
 * Called when the user requests image generation for a specific post.
 */

import prisma from '../lib/prisma';
import { generateImageFromPrompt, ImageGenerationResult } from './imageGenerator';
import { uploadImageToStorage } from './objectStorage';
import { getPostById, updatePostImage } from '../db/database';
import { analyzeImageSaliency } from './saliencyAnalyzer';
import { analyzeLocalColors } from './colorAnalyzer';
import { renderAdComposite } from './htmlRenderer';
import { createLogger } from '../utils/logger';
import { extractSubjectMask } from './subjectMasker';
import { evaluateImageQuality } from './qualityEvaluator';
import { generateLayoutBlueprint, determineGlassmorphism, microTuneHtmlContrast } from './layoutDirector';
import { callLlm } from '../utils/llmClient';
import { generateAdCopyBlueprint } from './copyDirector';
import { generateDetailedImagePrompt } from './generateImagePrompt';

const logger = createLogger({ service: 'on-demand-compositor' });



/**
 * Uses Groq to split a single base image prompt into 4 distinct, highly related,
 * visually continuous slide prompts to generate a beautiful, dynamic carousel panorama.
 */
async function generateCarouselSlidePrompts(params: {
  topic: string;
  caption: string;
  basePrompt: string;
  industry?: string;
}): Promise<string[]> {
  const { topic, caption, basePrompt, industry } = params;

  const ind = (industry || '').toLowerCase();
  const top = topic.toLowerCase();
  const isSkincare = ind.includes('skin') || ind.includes('beauty') || ind.includes('cosmetic') || ind.includes('care') || ind.includes('wellness') || top.includes('skin') || top.includes('beauty');

  let continuityGuidelines = '';
  if (isSkincare) {
    continuityGuidelines = `
  * Slide 0 (Cover): Must be the original base prompt exactly to maintain the cover hook.
  * Slide 1 (Key Strengths/Advantages): Focus on closeups, premium skincare bottles/jars, clean droplets, active ingredient textures (like clear serum, creamy moisturizer, botanical extracts, green leaves), elegant glass pipettes, or ingredients on premium marble/wooden slabs. No office desk, tech, or screens!
  * Slide 2 (Measurable Impact/Efficacy): Focus on outcomes conceptually, like radiant natural lighting, glowing glass skin surface reflections, fresh water ripples, elegant product groupings, or clean clinical settings. No laptops, offices, or charts!
  * Slide 3 (Action Call/CTA): Focus on the complete skincare routine, a luxurious bathroom sanctuary scene (with a standalone bathtub, plants, soft towels, and warm morning light), or an elegant vanity setup showing the bottles beautifully arranged.
`;
  } else {
    continuityGuidelines = `
  * Slide 0 (Cover): Must be the original base prompt exactly to maintain the cover hook.
  * Slide 1 (Key Strengths/Advantages): Focus on details, closeups, components, server rack systems, glowing fiber optics, workspace, or a detailed visual showing software capabilities.
  * Slide 2 (Measurable Impact/Efficacy): Focus on outcomes, clean abstract charts, high-tech dashboards with glowing progress bars, clean minimal shapes, or stylized metrics.
  * Slide 3 (Action Call/CTA): Focus on success, a sleek mockup frame, a premium floating interface, or glowing corporate launch elements.
`;
  }

  try {
    const response = await callLlm({
      model: process.env.CAROUSEL_PROMPT_MODEL || process.env.LLM_MODEL || 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `You are an expert D2C & B2B SaaS Visual Advertising Director. Your job is to take a base ad creative image prompt and split it into 4 distinct, highly related, visually continuous slide prompts for a multi-slide carousel.
These prompts will be used to generate 4 separate background images using an AI image generator (like Flux).
CRITICAL RULES FOR DESIGN AESTHETICS (PREVENTING AI HALLUCINATIONS):
1. NO HUMANS, NO FACES, NO HUMAN BODIES: Never include corporate teams, people standing, faces, or arms in the prompts. They generate mutated double-headed monsters in AI backdrops. Focus entirely on beautiful, premium environment scenery, high-tech server networks, conceptual shapes, or clean workspaces.
2. NO WRITTEN TEXT ON SCREENS: Never ask the AI to draw actual words, texts, labels, or numbers on dashboards or phone screens. Garbled AI text looks terrible. Instead, describe them as "glowing abstract visualization graphics", "stylized network connection nodes", "clean minimal UI shape interfaces", or "conceptual neon graphs with no legible words".
3. NO REALISTIC HANDS HOLDING PHONES: Never ask for "a hand holding a phone". It generates creepy extra fingers and overlapping stacked devices. Instead, ask for "a sleek futuristic mobile phone display floating conceptually over a minimalist pedestal" or "a premium clean dashboard display on a futuristic glass tablet resting on a desk".
4. VISUAL STYLES: Keep the scenes abstract, modern, corporate, high-end, and visually distinct but continuous in style, color palette, and lighting.

Guidelines for visual continuity:
- Maintain the same artistic style, lighting, camera settings, and color palette (derived from the base prompt).
- Each slide prompt must represent a different angle or focal point of the story, transitioning smoothly:${continuityGuidelines}
- Return a JSON object with a single field "prompts" which is an array of exactly 4 strings.
- Example JSON output:
{
  "prompts": [
    "original base prompt",
    "prompt for slide 1",
    "prompt for slide 2",
    "prompt for slide 3"
  ]
}`
        },
        {
          role: 'user',
          content: `Post Topic: "${topic}"
Post Caption: "${caption}"
Base Image Prompt: "${basePrompt}"

Generate 4 continuous, premium carousel prompts.`
        }
      ],
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(response.choices[0].message.content || '{}');
    if (Array.isArray(parsed.prompts) && parsed.prompts.length === 4) {
      // Force Slide 0 to be the basePrompt
      parsed.prompts[0] = basePrompt;
      return parsed.prompts;
    }
  } catch (err) {
    logger.warn(`Failed to generate carousel slide prompts using LLM: ${err instanceof Error ? err.message : String(err)}. Falling back to basePrompt clones.`);
  }

  // Fallback: repeat basePrompt
  return [basePrompt, basePrompt, basePrompt, basePrompt];
}



/**
 * Generate premium composite ad image for a specific post on-demand.
 *
 * Upgraded Workflow:
 * 1. Fetch post and campaign branding guidelines (logos, colors) from DB.
 * 2. Generate a clean background base image using the stored detailed visual prompt.
 * 3. Analyze image saliency layout to solve for the safest corners for overlays.
 * 4. Sample background pixels to mathematically guarantee relative luminance legibility.
 * 5. Composite Z-Index graphics layers and typography using Playwright.
 * 6. Upload final composite PNG to MinIO/S3 object storage.
 * 7. Update database record with final URL.
 *
 * @param postId - UUID of the post
 * @returns Public URL of generated ad composite
 */
export async function generatePostImage(
  postId: string,
  disableHtml: boolean = false,
  force: boolean = false,
  templateStyleOverride?: string,
  layoutTypeOverride?: 'classic' | 'feature_list' | 'editorial_column' | 'split_screen',
  feedback?: string
): Promise<string> {
  // Test hook override for hermetic isolation
  if ((global as any).__generatePostImageMock) {
    return (global as any).__generatePostImageMock(postId, disableHtml, force, templateStyleOverride, layoutTypeOverride, feedback);
  }

  logger.info(`Starting high-fidelity ad generation loop for post: ${postId} (disableHtml: ${disableHtml}, force: ${force}, templateStyleOverride: ${templateStyleOverride}, layoutTypeOverride: ${layoutTypeOverride}, feedback: ${feedback ? feedback.substring(0, 30) + '...' : 'none'})`);

  try {
    // STEP 1: Fetch post
    const post = await getPostById(postId);

    if (!post) {
      throw new Error(`Post not found: ${postId}`);
    }

    if (!post.imagePrompt) {
      throw new Error('Post does not have a detailed image prompt');
    }

    // Bypass if image already successfully generated and not forced
    if (post.imageUrl && post.imageGenerated && !force) {
      logger.info(`Post already has generated image composite: ${post.imageUrl}`);
      return post.imageUrl;
    }

    // Fetch related campaign branding context from database via Prisma
    const campaign = await prisma.socialCampaign.findUnique({
      where: { id: post.campaignId },
      select: { 
        brandLogo: true, 
        companyName: true, 
        name: true, 
        industry: true, 
        brandColor: true, 
        accentColor: true, 
        services: true,
        geography: true,
        companyDesc: true,
        tone: true,
        goal: true,
        funnelId: true,
        strategy: {
          select: {
            contentPillars: true,
            tone: true,
            ctaStyle: true,
            contentMix: true,
            campaignPhases: true
          }
        }
      }
    });

    let brandLogoUrl = campaign?.brandLogo || '';
    let brandName = campaign?.companyName || '';
    let resolvedBrandColor = campaign?.brandColor || '#764ba2';
    let resolvedAccentColor = campaign?.accentColor || '#667eea';

    // Fallback: If campaign has empty/null branding info or defaults, fetch live genie context for funnel
    if (campaign?.funnelId && (!brandLogoUrl || !brandName || resolvedBrandColor === '#764ba2' || resolvedAccentColor === '#667eea')) {
      try {
        const { fetchGenieContext } = await import('./genieContext');
        const genieCtx = await fetchGenieContext(campaign.funnelId);
        if (genieCtx) {
          if (!brandLogoUrl && genieCtx.brandLogo) {
            brandLogoUrl = genieCtx.brandLogo;
          }
          if (!brandName && genieCtx.companyName) {
            brandName = genieCtx.companyName;
          }
          if (resolvedBrandColor === '#764ba2' && genieCtx.brandColor) {
            resolvedBrandColor = genieCtx.brandColor;
          }
          if (resolvedAccentColor === '#667eea' && genieCtx.brandAccentColor) {
            resolvedAccentColor = genieCtx.brandAccentColor;
          }
        }
      } catch (err: any) {
        logger.warn(`Failed to fetch fallback genie context: ${err.message}`);
      }
    }

    if (!brandName) {
      brandName = campaign?.name || campaign?.industry || 'Aladdyn Social';
    }

    logger.info(`Campaign branding context loaded. Logo: ${brandLogoUrl || 'None'}, Brand Name: ${brandName}, Brand Color: ${resolvedBrandColor}, Accent Color: ${resolvedAccentColor}`);

    // PRE-PASS: Run Copy Director & Layout Director early so the HTML layout is planned first
    // and strictly dictates the negative space zone for background image generation.
    logger.info('Running early Copy Director pass to establish copywriting...');
    let copyBlueprint: import('../types/content').CopyBlueprint | undefined;
    try {
      copyBlueprint = await generateAdCopyBlueprint({
        topic: post.topic || undefined,
        caption: post.caption || undefined,
        contentPillar: post.contentPillar || (post.metadata as any)?.contentPillar || undefined,
        brandName: brandName,
        industry: campaign?.industry || 'Lifestyle',
        tone: campaign?.tone || campaign?.strategy?.tone || undefined
      });
      logger.info(`✓ Early copy pass complete. Intent: ${copyBlueprint.intent}`);
    } catch (e: any) {
      logger.warn(`Early copy pass failed: ${e.message}`);
    }

    // Run Layout Director in Abstract Mode to plan design archetype and negative space zone first
    logger.info('Running early Layout Director pass to design layout abstractly...');
    let layoutBlueprint: any = undefined;
    let plannedZone: import('./generateImagePrompt').NegativeSpaceZone = 'left_column';
    try {
      const indLower = (campaign?.industry || '').toLowerCase();
      const isServiceOrB2B = indLower.includes('software') || indLower.includes('saas') || indLower.includes('service') || indLower.includes('learning') || indLower.includes('education') || indLower.includes('tech');
      const abstractZone = isServiceOrB2B ? 'left_column' : 'left_column';

      const overlayIsDarkBg = false;
      const overlayHeadlineColor = campaign?.brandColor && campaign.brandColor !== '#FFFFFF' && campaign.brandColor !== '#ffffff'
        ? campaign.brandColor
        : '#0F172A';
      const overlaySubtitleColor = '#334155';
      const overlayAvgHex = '#F8F8F6';
      const overlayAvgName = 'White Gradient Panel (HTML overlay)';

      layoutBlueprint = await generateLayoutBlueprint({
        imagePrompt: post.imagePrompt || post.topic || 'Premium brand background scene',
        industry: campaign?.industry || 'Lifestyle',
        services: campaign?.services || [],
        baseColor: campaign?.brandColor || '#000000',
        accentColor: campaign?.accentColor || undefined,
        geography: campaign?.geography || undefined,
        safestQuadrant: abstractZone,
        contrastMetrics: {
          isDarkBg: overlayIsDarkBg,
          headlineColor: overlayHeadlineColor,
          subtitleColor: overlaySubtitleColor,
          averageColorHex: overlayAvgHex,
          averageColorName: overlayAvgName
        },
        canvasDimensions: { width: 1080, height: 1080 },
        slideIndex: undefined,
        feedback: feedback,
        copyBlueprint: copyBlueprint!
      });

      // Parse the negative space zone from Layout Blueprint
      if (layoutBlueprint) {
        // 1. Programmatic readability safety rule: If there are checklist items / features in copy, force editorial_left_bleed
        const featureElements = copyBlueprint?.elements?.filter(e => e.type === 'feature' || e.type === 'statistic') || [];
        const hasList = featureElements.length >= 2 || (layoutBlueprint.features && layoutBlueprint.features.length >= 2);
        if (hasList) {
          layoutBlueprint.layoutType = 'editorial_column';
          layoutBlueprint.designArchetype = 'editorial_left_bleed';
          layoutBlueprint.requireGlassmorphism = false;
          logger.info('[LayoutOverride] Dense checklist/list detected. Programmatically enforced editorial_left_bleed (white gradient panel) layout style.');
        }

        // 2. Programmatic testimonial safety rule: If there is a customer review quote, force organic_minimalist archetype
        const hasQuote = copyBlueprint?.elements?.some(e => e.type === 'quote') || (copyBlueprint && copyBlueprint.intent === 'trust');
        if (hasQuote && !hasList) {
          layoutBlueprint.designArchetype = 'organic_minimalist';
          logger.info('[LayoutOverride] Customer testimonial/review quote detected. Programmatically enforced organic_minimalist review-focused layout style.');
        }

        const arch = (layoutBlueprint.designArchetype || '').toLowerCase();
        const lType = (layoutBlueprint.layoutType || '').toLowerCase();
        if (lType === 'editorial_column' || arch.includes('left_bleed') || arch.includes('left_panel')) {
          plannedZone = 'left_column';
        } else if (arch.includes('right_bleed') || arch.includes('right_panel')) {
          plannedZone = 'right_column';
        } else if (arch.includes('top_band') || arch.includes('top_panel')) {
          plannedZone = 'top_band';
        } else if (arch.includes('bottom_band') || arch.includes('bottom_panel')) {
          plannedZone = 'bottom_band';
        } else if (arch.includes('center') || arch.includes('clear')) {
          plannedZone = 'center_clear';
        } else {
          // Check layoutBlueprint quadrant/safestQuadrant placement
          const q = (layoutBlueprint.layoutType === 'classic' || layoutBlueprint.layoutType === 'feature_list') && layoutBlueprint.dynamicHtmlBlock
            ? (layoutBlueprint.dynamicHtmlBlock.includes('right:') ? 'right_column' : 'left_column')
            : 'left_column';
          plannedZone = q as any;
        }
      }

      logger.info(`✓ Layout Director abstract pass complete. Archetype: ${layoutBlueprint?.designArchetype}, Planned Zone: ${plannedZone}`);
    } catch (e: any) {
      logger.warn(`Layout Director abstract pass failed, using fallback layout constraints: ${e.message}`);
    }

    // EXPLICIT SAY-SO INSTRUCTION FOR DYNAMIC IMAGE PROMPT RE-GENERATION:
    // We re-generate the visual image prompt on-the-fly using the brand colors, strategy,
    // and layout contrast constraints, so that the HTML Renderer/Layout preferences
    // strictly drive the image generation process rather than using stale prompts from the database.
    logger.info('Piping layout compositor preferences to background prompt generator...');
    try {
      const indLower = (campaign?.industry || '').toLowerCase();
      const isServiceOrB2B = indLower.includes('software') || indLower.includes('saas') || indLower.includes('service') || indLower.includes('learning') || indLower.includes('education') || indLower.includes('tech');
      const preferredLayout = layoutBlueprint?.designArchetype || (isServiceOrB2B ? 'editorial_left_bleed' : 'classic');

      const normalizedInput = {
        industry: campaign?.industry || 'Lifestyle',
        geography: campaign?.geography || 'India',
        services: campaign?.services || [],
        base_color: campaign?.brandColor || '#000000',
        accent_color: campaign?.accentColor || '#8B5CF6',
        font_style: campaign?.strategy?.ctaStyle || 'Plus Jakarta Sans'
      };

      const strategyContext = {
        tone: campaign?.tone || 'Professional'
      };

      const itemContext = {
        topic: post.topic || 'Special Spotlight',
        pillar: post.contentPillar || (post.metadata as any)?.contentPillar || 'Product Showcase',
        date: typeof post.scheduledTime === 'string'
          ? post.scheduledTime
          : (post.scheduledTime instanceof Date ? post.scheduledTime.toISOString() : new Date().toISOString()),
        is_festival: false
      };

      const updatedPrompt = await generateDetailedImagePrompt(
        itemContext as any,
        strategyContext as any,
        normalizedInput as any,
        feedback,
        preferredLayout,
        plannedZone
      );

      logger.info(`✓ Successfully updated image prompt with HTML Renderer constraints: "${updatedPrompt.slice(0, 120)}..."`);
      post.imagePrompt = updatedPrompt;

      // Persist the updated image prompt in the database so that layout constraints are saved permanently
      await prisma.socialPost.update({
        where: { id: postId },
        data: { imagePrompt: updatedPrompt }
      });
      logger.info(`✓ Persisted layout-driven negative space prompt in the database successfully.`);
    } catch (e: any) {
      logger.error(`Dynamic image prompt re-generation failed, falling back to original prompt: ${e.message}`);
    }

    // STEP 2: Generate clean background base image from prompt
    logger.info('Generating background base scene from prompt...');
    let baseImageResult = await generateImageFromPrompt(post.imagePrompt);
    logger.info(`✓ Background generated successfully using model: ${baseImageResult.metadata.model}`);

    // STEP 2.5: Automated Heuristics Quality Gate & Re-roll
    const qualityParams = {
      baseColor: campaign?.brandColor || undefined,
      accentColor: campaign?.accentColor || undefined,
    };
    
    let qualityResult = await evaluateImageQuality(baseImageResult.imageBuffer, qualityParams);
    
    // Run Saliency Grid & Mask occupancy verification checks (CV Collision Gate)
    let cvGatePassed = true;
    let cvGateReason = '';
    let zoneScore = 0;
    try {
      const baseSaliency = await analyzeImageSaliency(baseImageResult.imageBuffer);
      if (plannedZone === 'left_column') {
        zoneScore = ((baseSaliency.quadrantScores.top_left || 0) +
                     (baseSaliency.quadrantScores.middle_left || 0) +
                     (baseSaliency.quadrantScores.bottom_left || 0)) / 3;
      } else if (plannedZone === 'right_column') {
        zoneScore = ((baseSaliency.quadrantScores.top_right || 0) +
                     (baseSaliency.quadrantScores.middle_right || 0) +
                     (baseSaliency.quadrantScores.bottom_right || 0)) / 3;
      } else if (plannedZone === 'top_band') {
        zoneScore = ((baseSaliency.quadrantScores.top_left || 0) +
                     (baseSaliency.quadrantScores.top_center || 0) +
                     (baseSaliency.quadrantScores.top_right || 0)) / 3;
      } else if (plannedZone === 'bottom_band') {
        zoneScore = ((baseSaliency.quadrantScores.bottom_left || 0) +
                     (baseSaliency.quadrantScores.bottom_center || 0) +
                     (baseSaliency.quadrantScores.bottom_right || 0)) / 3;
      } else if (plannedZone === 'center_clear') {
        zoneScore = baseSaliency.quadrantScores.center || 0;
      }

      logger.info(`CV Gate Saliency Verification: Planned Zone '${plannedZone}' score is ${zoneScore.toFixed(3)}`);
      if (zoneScore > 0.32) {
        cvGatePassed = false;
        cvGateReason = `Saliency in planned negative space zone '${plannedZone}' is too high (${zoneScore.toFixed(3)} > 0.32)`;
      }
    } catch (e: any) {
      logger.warn(`Saliency CV verification failed: ${e.message}`);
    }

    // ── CV Emergency Re-roll ────────────────────────────────────────────────
    // If saliency is CATASTROPHICALLY high (>0.70) in the planned empty zone,
    // fire exactly ONE re-roll with an emergency body-clearance prefix injected
    // directly into the prompt. This prevents the half-body cutoff issue where
    // a human subject bleeds into the text overlay area (e.g. saliency 0.947).
    if (!cvGatePassed && zoneScore > 0.70) {
      logger.warn(`CV Collision Gate CRITICAL: zone saliency=${zoneScore.toFixed(3)} — triggering emergency single re-roll with body-clearance override.`);
      try {
        const zoneBodyOverrides: Record<string, string> = {
          left_column:   'EMERGENCY SPATIAL OVERRIDE: The leftmost 45% of the image MUST be a completely empty, featureless wall or plain backdrop. NO human body parts whatsoever — no head, no face, no shoulders, no arms, no legs — may appear in the left 45%. The person/subject MUST be entirely within the rightmost 55%, shot from far enough away that their full silhouette including head is visible and well inside the right side. Wide establishing shot only.',
          right_column:  'EMERGENCY SPATIAL OVERRIDE: The rightmost 45% of the image MUST be a completely empty, featureless wall or plain backdrop. NO human body parts whatsoever may appear in the right 45%. The person/subject MUST be entirely within the leftmost 55%.',
          top_band:      'EMERGENCY SPATIAL OVERRIDE: The top 40% of the image MUST be a completely empty, featureless sky or ceiling. NO human body parts — no raised arms, no head, no face — may appear in the top 40%. All people must be in the bottom 60%.',
          bottom_band:   'EMERGENCY SPATIAL OVERRIDE: The bottom 40% of the image MUST be a completely empty, featureless floor. NO human legs, feet, or lower body may appear in the bottom 40%.',
          center_clear:  'EMERGENCY SPATIAL OVERRIDE: The center third of the image MUST be completely empty and featureless. NO human body parts may appear in the center third.',
        };
        const emergencyPrefix = zoneBodyOverrides[plannedZone] || zoneBodyOverrides['left_column'];
        const emergencyPrompt = `${emergencyPrefix}\n\n${post.imagePrompt}`;
        logger.info(`Re-rolling with emergency override prompt (${emergencyPrompt.length} chars)...`);
        const rerollResult = await generateImageFromPrompt(emergencyPrompt);
        // Verify the re-roll improved things
        const rerollSaliency = await analyzeImageSaliency(rerollResult.imageBuffer);
        let rerollZoneScore = 0;
        if (plannedZone === 'left_column') {
          rerollZoneScore = ((rerollSaliency.quadrantScores.top_left || 0) +
                             (rerollSaliency.quadrantScores.middle_left || 0) +
                             (rerollSaliency.quadrantScores.bottom_left || 0)) / 3;
        } else if (plannedZone === 'right_column') {
          rerollZoneScore = ((rerollSaliency.quadrantScores.top_right || 0) +
                             (rerollSaliency.quadrantScores.middle_right || 0) +
                             (rerollSaliency.quadrantScores.bottom_right || 0)) / 3;
        } else {
          rerollZoneScore = zoneScore; // keep original for other zones
        }
        logger.info(`Re-roll CV Gate score: ${rerollZoneScore.toFixed(3)} (was ${zoneScore.toFixed(3)})`);
        if (rerollZoneScore < zoneScore) {
          // Re-roll improved things — use it
          baseImageResult = rerollResult;
          logger.info(`✓ Emergency re-roll accepted (score improved: ${zoneScore.toFixed(3)} → ${rerollZoneScore.toFixed(3)})`);
          if (rerollZoneScore <= 0.32) cvGatePassed = true;
        } else {
          logger.warn(`Emergency re-roll did not improve zone saliency (${rerollZoneScore.toFixed(3)} >= ${zoneScore.toFixed(3)}). Continuing with original.`);
        }
      } catch (rerollErr: any) {
        logger.error(`Emergency re-roll failed: ${rerollErr.message}. Continuing with original image.`);
      }
    } else if (!cvGatePassed) {
      logger.warn(`CV Collision Gate failed: ${cvGateReason}. Saliency is elevated but not catastrophic — compositing with micro-contrast shields.`);
    }
    // ──────────────────────────────────────────────────────────────────────

    let finalAdCreativeResult: ImageGenerationResult;

    if (disableHtml) {
      logger.info('Skipping Playwright HTML compositing layer on request (raw AI output only).');
      finalAdCreativeResult = {
        imageBuffer: baseImageResult.imageBuffer,
        metadata: {
          model: baseImageResult.metadata.model,
          dimensions: baseImageResult.metadata.dimensions || { width: 1080, height: 1080 },
          prompt: baseImageResult.metadata.prompt
        }
      };
    } else {
      // STEP 3: Subject Extraction Masking (editorial_left_bleed only)
      // 3D Depth Sandwiching is enabled exclusively for editorial_column layouts where
      // the subject is clearly on the right side and the text panel is on the left.
      // This creates the premium "subject in front of text" depth illusion.
      let subjectMaskUrl: string | undefined = undefined;
      let maskBuffer: Buffer | undefined = undefined;

      const isEditorialLayout = layoutBlueprint?.layoutType === 'editorial_column';

      if (isEditorialLayout) {
        logger.info('3D Depth Sandwiching: editorial_left_bleed detected — extracting subject mask for depth effect.');
        try {
          const { extractSubjectMask } = await import('./subjectMasker');
          maskBuffer = await extractSubjectMask(baseImageResult.imageBuffer);
          logger.info(`✓ Subject mask extracted (${(maskBuffer.length / 1024).toFixed(1)} KB)`);

          // Upload mask to MinIO so Playwright can load it via URL
          const { uploadBufferToStorage } = await import('./objectStorage');
          const maskPrefix = `masks/${postId}-${Date.now()}`;
          subjectMaskUrl = await uploadBufferToStorage(maskBuffer, 'image/png', maskPrefix);
          logger.info(`✓ Subject mask uploaded: ${subjectMaskUrl}`);
        } catch (maskErr: any) {
          logger.warn(`Subject mask extraction failed (non-fatal, continuing without depth): ${maskErr.message}`);
          subjectMaskUrl = undefined;
          maskBuffer = undefined;
        }
      } else {
        logger.info('3D Depth Sandwiching: disabled for non-editorial layout (skipping subject mask extraction).');
      }

      // STEP 4: Relative luminance localized color contrast solve for planned zone
      const chosenQuadrant = plannedZone === 'left_column' ? 'top_left' : 
                             plannedZone === 'right_column' ? 'top_right' :
                             plannedZone === 'top_band' ? 'top_center' :
                             plannedZone === 'bottom_band' ? 'bottom_center' :
                             'center';
      logger.info(`Sampling local color contrast for planned chosen quadrant: ${chosenQuadrant}`);
      const finalColorMetrics = await analyzeLocalColors(baseImageResult.imageBuffer, chosenQuadrant, 8);

      // STEP 5: Micro-Contrast Tuning Pass on pre-planned HTML overlay
      if (layoutBlueprint && layoutBlueprint.dynamicHtmlBlock) {
        logger.info('Running Micro-Contrast Tuning Pass on pre-planned HTML overlay...');
        const overlayIsDarkBg = finalColorMetrics.isDarkBg;
        const overlayHeadlineColor = resolvedBrandColor && resolvedBrandColor !== '#FFFFFF' && resolvedBrandColor !== '#ffffff'
          ? resolvedBrandColor
          : (overlayIsDarkBg ? '#FFFFFF' : '#0F172A');
        const overlaySubtitleColor = overlayIsDarkBg ? '#E2E8F0' : '#334155';
        const overlayAccentColor = layoutBlueprint?.accentColorOverride || resolvedAccentColor || undefined;
        
        layoutBlueprint.dynamicHtmlBlock = microTuneHtmlContrast(
          layoutBlueprint.dynamicHtmlBlock,
          {
            isDarkBg: overlayIsDarkBg,
            headlineColor: overlayHeadlineColor,
            subtitleColor: overlaySubtitleColor,
            averageColorHex: finalColorMetrics.averageColorHex || '#000000',
            accentColor: overlayAccentColor
          },
          layoutBlueprint.requireGlassmorphism || false,
          layoutBlueprint.layoutType || 'classic'
        );
      }

      // Calculate the cutout occupancy of the final chosen text overlay quadrant
      let cutoutOverlap = 0;
      if (maskBuffer) {
        try {
          const maskSaliency = await analyzeImageSaliency(maskBuffer);
          cutoutOverlap = maskSaliency.quadrantScores[chosenQuadrant] || 0;
          logger.info(`Cutout occupancy in chosen text quadrant '${chosenQuadrant}': ${(cutoutOverlap * 100).toFixed(1)}%`);
        } catch (maskSalErr: any) {
          logger.error(`Cutout saliency analysis failed: ${maskSalErr.message}`);
        }
      }

      // Determine final typography Z-Index
      let typographyZIndex: 'behind' | 'in_front' = 'in_front'; // Safe default
      if (layoutBlueprint) {
        if (isEditorialLayout && subjectMaskUrl) {
          // Depth sandwiching is active: HTML panel sits BETWEEN background and subject mask.
          // This places the subject cutout ABOVE the text panel, creating the 3D depth effect.
          typographyZIndex = 'behind';
          layoutBlueprint.typographyZIndex = 'behind';
          logger.info('3D Depth Sandwiching active: Typography set BEHIND subject mask (editorial depth effect).');
        } else {
          typographyZIndex = 'in_front';
          layoutBlueprint.typographyZIndex = 'in_front';
          logger.info('Typography forced IN FRONT of subject (no depth sandwiching).');
        }
      }

      // Apply the definitive glassmorphism decider using resampled final color metrics
      if (layoutBlueprint) {
        layoutBlueprint.requireGlassmorphism = determineGlassmorphism({
          llmRequireGlassmorphism: layoutBlueprint.requireGlassmorphism,
          bgOpacityOverride: finalColorMetrics.bgOpacityOverride,
          imagePrompt: post.imagePrompt,
          layoutType: layoutTypeOverride || layoutBlueprint.layoutType || 'classic'
        });
      }

      // STEP 6: Composite Z-Index multi-layer ad rendering using Playwright
      
      // Deterministically pick a template style for this post so it looks consistent on repeated renders
      // but varies across different posts in the campaign.
      const styles: Array<'glass' | 'bold' | 'elegant'> = ['glass', 'bold', 'elegant'];
      
      // Hash the postId to select a template style deterministically
      let hash = 0;
      for (let i = 0; i < postId.length; i++) {
        hash = postId.charCodeAt(i) + ((hash << 5) - hash);
      }
      const styleIndex = Math.abs(hash) % styles.length;
      
      // Select template style: override > AI Layout Director archetype > deterministic hash
      const templateStyle = templateStyleOverride || layoutBlueprint?.designArchetype || styles[styleIndex];

      logger.info(`Assembling composite layers | Template style: '${templateStyle}'...`);
      
      const headline = post.topic || 'Special Spotlight';
      const cta = post.callToAction || 'Learn More';

      const adWidth = 1080;
      const adHeight = 1080;

      const isCarousel = post.contentType?.toLowerCase() === 'carousel';

      if (isCarousel) {
        logger.info(`[Carousel] Deforming carousel ad layout! Post ${postId} requires a 4-slide completely custom carousel.`);
        
        // 1. Generate 4 visually continuous prompts using Groq
        const slidePrompts = await generateCarouselSlidePrompts({
          topic: post.topic || '',
          caption: post.caption || '',
          basePrompt: post.imagePrompt || 'Premium brand advertising backplate',
          industry: campaign?.industry || undefined
        });

        logger.info(`[Carousel] Successfully generated 4 distinct slide prompts:`);
        slidePrompts.forEach((p, idx) => logger.info(`   * Slide ${idx + 1}: ${p.slice(0, 70)}...`));



        const slideUrls: string[] = [];

        // 2. Loop and run full autonomous design pipeline for each slide individually!
        for (let slideIdx = 0; slideIdx < 4; slideIdx++) {
          logger.info(`\n=========================================`);
          logger.info(`🎨 [Carousel] Generating Slide ${slideIdx + 1}/4`);
          logger.info(`=========================================`);

          // A. Generate Slide Background
          logger.info(`[Carousel] Generating AI background from prompt...`);
          const slideImageResult = await generateImageFromPrompt(slidePrompts[slideIdx]);

          // B. Subject mask cutout extraction
          let slideMaskUrl = '';
          // 3D Depth Sandwiching is disabled entirely globally for carousels.
          logger.info('[Carousel] 3D Depth Sandwiching is disabled. Skipping subject mask cutout extraction.');

          // C. Image saliency overlay detection
          logger.info(`[Carousel] Analyzing spatial grid saliency layout...`);
          const saliencyResult = await analyzeImageSaliency(slideImageResult.imageBuffer);
          const slideQuadrant = saliencyResult.safestQuadrant;
          logger.info(`[Carousel] Solved safest quadrant corner: ${slideQuadrant}`);

          // D. Localized color contrast sampling
          logger.info(`[Carousel] Sampling luminance contrast safe colors...`);
          const slideColors = await analyzeLocalColors(slideImageResult.imageBuffer, slideQuadrant, 8);

          // D.5 Copy Director Pass for this specific slide
          logger.info(`[Carousel] Invoking Copy Director to extract text for Slide ${slideIdx + 1}...`);
          let slideFocus = post.topic || '';
          if (slideIdx === 0) slideFocus = `Cover/Hook: ${post.topic}`;
          if (slideIdx === 1) slideFocus = `Features/Strengths: Highlighting the core value or ingredients for ${post.topic}`;
          if (slideIdx === 2) slideFocus = `Results/Efficacy: The tangible benefits of ${post.topic}`;
          if (slideIdx === 3) slideFocus = `Call to Action: Try ${brandName} today!`;

          const slideCopyBlueprint = await generateAdCopyBlueprint({
            topic: slideFocus,
            caption: post.caption || undefined,
            contentPillar: post.contentPillar || undefined,
            brandName: brandName,
            industry: campaign?.industry || 'Lifestyle',
            tone: campaign?.tone || undefined
          });

          // E. Run Layout Director LLM to design custom template for this specific slide!
          logger.info(`[Carousel] Invoking Layout Director to design dynamic blueprint...`);
          let slideBlueprint = await generateLayoutBlueprint({
            imagePrompt: slidePrompts[slideIdx],
            industry: campaign?.industry || 'skincare',
            services: campaign?.services || [],
            baseColor: resolvedBrandColor || '#8B5CF6',
            accentColor: resolvedAccentColor || undefined,
            geography: campaign?.geography || undefined,
            safestQuadrant: slideQuadrant,
            contrastMetrics: {
              isDarkBg: slideColors.isDarkBg,
              headlineColor: slideColors.headlineColor,
              subtitleColor: slideColors.subtitleColor,
              averageColorHex: slideColors.averageColorHex,
              averageColorName: slideColors.averageColorName
            },
            canvasDimensions: { width: adWidth, height: adHeight },
            slideIndex: slideIdx,
            feedback: feedback,
            copyBlueprint: slideCopyBlueprint
          });

          // F. Composite layers using Playwright HTML Renderer
          logger.info(`[Carousel] Rendering high-fidelity dynamic slide composite...`);
          const slideBuffer = await renderAdComposite({
            baseImageBuffer: slideImageResult.imageBuffer,
            brandLogoUrl,
            brandName,
            templateStyle: templateStyleOverride || slideBlueprint.designArchetype,
            subjectMaskUrl: slideMaskUrl || undefined,
            headline: slideCopyBlueprint.primaryHeadline || headline,
            subtitle: slideCopyBlueprint.secondarySubtitle || '',
            cta: (() => {
              const ctaEl = slideCopyBlueprint.elements?.find(e => e.type === 'cta');
              if (!ctaEl) return cta;
              const iconHtml = ctaEl.iconName ? `<i data-lucide="${ctaEl.iconName}" style="width: 16px; height: 16px; margin-right: 2px;"></i>` : '';
              return `${iconHtml} ${ctaEl.text}`.trim();
            })(),
            quadrant: slideQuadrant,
            colors: slideColors,
            width: adWidth,
            height: adHeight,
            slideIndex: slideIdx,
            brandColor: resolvedBrandColor || undefined,
            accentColor: resolvedAccentColor || undefined,
            geography: campaign?.geography || undefined,
            industry: campaign?.industry || undefined,
            topic: post.topic || undefined,
            copyElements: slideCopyBlueprint?.elements || [],
            layoutBlueprint: {
              ...slideBlueprint,
              // Pass dynamicHtmlBlock through; htmlRenderer validates and falls back if malformed
              layoutType: slideBlueprint.layoutType
            }
          });

          const slideUploadResult = {
            imageBuffer: slideBuffer,
            metadata: {
              model: `${slideImageResult.metadata.model} + Playwright Dynamic Compositor (Slide ${slideIdx + 1})`,
              dimensions: { width: adWidth, height: adHeight },
              prompt: slidePrompts[slideIdx]
            }
          };

          const slideUrl = await uploadImageToStorage(slideUploadResult, `posts/${postId}/slide_${slideIdx}/`);
          logger.info(`[Carousel] Slide ${slideIdx + 1} uploaded successfully! URL: ${slideUrl}`);
          slideUrls.push(slideUrl);
        }

        const combinedUrls = slideUrls.join(',');
        logger.info(`\n[Carousel] All 4 dynamic slides successfully enqueued and uploaded. Comma URLs: ${combinedUrls}`);

        // Update database record
        await updatePostImage(postId, combinedUrls, `Playwright Multi-Prompt Dynamic Carousel Compositor`);
        logger.info('✓ Campaign database post record updated successfully for dynamic carousel.');
        
        return slideUrls[0];
      } else {
        const compositePngBuffer = await renderAdComposite({
          baseImageBuffer: baseImageResult.imageBuffer,
          brandLogoUrl,
          brandName,
          templateStyle,
          subjectMaskUrl,
          headline: copyBlueprint?.primaryHeadline || headline,
          subtitle: copyBlueprint?.secondarySubtitle || '',
          cta: (() => {
            const ctaEl = copyBlueprint?.elements?.find((e: any) => e.type === 'cta');
            if (!ctaEl) return cta;
            const iconHtml = ctaEl.iconName ? `<i data-lucide="${ctaEl.iconName}" style="width: 16px; height: 16px; margin-right: 2px;"></i>` : '';
            return `${iconHtml} ${ctaEl.text}`.trim();
          })(),
          quadrant: chosenQuadrant,
          colors: finalColorMetrics,
          width: adWidth,
          height: adHeight,
          brandColor: resolvedBrandColor || undefined,
          accentColor: resolvedAccentColor || undefined,
          geography: campaign?.geography || undefined,
          industry: campaign?.industry || undefined,
          topic: post.topic || undefined,
          copyElements: copyBlueprint?.elements || [],
          layoutBlueprint: layoutBlueprint ? {
            ...layoutBlueprint,
            // Pass dynamicHtmlBlock through; htmlRenderer validates and falls back if malformed
            layoutType: layoutTypeOverride || layoutBlueprint.layoutType
          } : {
            layoutType: layoutTypeOverride || 'classic'
          } as any
        });

        logger.info('✓ Playwright successfully rendered premium composite buffer.');

        // STEP 7: Wrap and upload final composite PNG to MinIO/S3
        finalAdCreativeResult = {
          imageBuffer: compositePngBuffer,
          metadata: {
            model: `${baseImageResult.metadata.model} + Playwright 3D Compositor`,
            dimensions: {
              width: adWidth,
              height: adHeight
            },
            prompt: baseImageResult.metadata.prompt
          }
        };
      }
    }

    logger.info('Uploading final composite ad creative to object storage...');
    const imageUrl = await uploadImageToStorage(finalAdCreativeResult, `posts/${postId}/`);
    logger.info(`✓ Uploaded successfully. URL: ${imageUrl}`);

    // STEP 8: Update database record
    await updatePostImage(postId, imageUrl, finalAdCreativeResult.metadata.model);
    logger.info('✓ Campaign database post record updated successfully.');

    return imageUrl;

  } catch (error: any) {
    logger.error(`✗ Ad generation loop failed for post ${postId}: ${error.message}`);
    throw new Error(
      `Premium ad generation failed: ${error.message}`
    );
  }
}

/**
 * Batch generate images for multiple posts
 */
export async function generatePostImages(
  postIds: string[]
): Promise<Map<string, { success: boolean; imageUrl?: string; error?: string }>> {
  logger.info(`Batch generating ad composites for ${postIds.length} posts...`);

  const results = new Map<string, { success: boolean; imageUrl?: string; error?: string }>();

  for (const [index, postId] of postIds.entries()) {
    logger.info(`[Batch Progress] [${index + 1}/${postIds.length}] Processing post: ${postId}`);

    try {
      const imageUrl = await generatePostImage(postId);
      results.set(postId, { success: true, imageUrl });
    } catch (error: any) {
      logger.error(`[Batch Failure] Failed for post ${postId}: ${error.message}`);
      results.set(postId, { success: false, error: error.message });
    }
  }

  const successCount = Array.from(results.values()).filter((r) => r.success).length;
  logger.info(`[Batch Complete] Successfully generated ${successCount}/${postIds.length} ad composites.`);

  return results;
}
