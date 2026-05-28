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
import { generateLayoutBlueprint, determineGlassmorphism } from './layoutDirector';
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

    const brandLogoUrl = campaign?.brandLogo || '';
    const brandName = campaign?.companyName || campaign?.name || campaign?.industry || 'Aladdyn Social';

    logger.info(`Campaign branding context loaded. Logo: ${brandLogoUrl || 'None'}, Brand Name: ${brandName}`);

    // EXPLICIT SAY-SO INSTRUCTION FOR DYNAMIC IMAGE PROMPT RE-GENERATION:
    // We re-generate the visual image prompt on-the-fly using the brand colors, strategy,
    // and layout contrast constraints, so that the HTML Renderer/Layout preferences
    // strictly drive the image generation process rather than using stale prompts from the database.
    logger.info('Piping layout compositor preferences to background prompt generator...');
    try {
      const indLower = (campaign?.industry || '').toLowerCase();
      const isServiceOrB2B = indLower.includes('software') || indLower.includes('saas') || indLower.includes('service') || indLower.includes('learning') || indLower.includes('education') || indLower.includes('tech');
      const preferredLayout = isServiceOrB2B ? 'editorial_left_bleed' : 'classic';

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
        preferredLayout
      );

      logger.info(`✓ Successfully updated image prompt with HTML Renderer constraints: "${updatedPrompt.slice(0, 120)}..."`);
      post.imagePrompt = updatedPrompt;
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
    if (!qualityResult.passed) {
      logger.warn(`Quality Gate failed on first attempt: [${qualityResult.reasons.join(', ')}]. Re-rolling background generation once...`);
      // Retry once
      baseImageResult = await generateImageFromPrompt(post.imagePrompt);
      qualityResult = await evaluateImageQuality(baseImageResult.imageBuffer, qualityParams);
      logger.info(`Re-rolled Quality Gate outcome: passed=${qualityResult.passed}, score=${qualityResult.score.toFixed(2)}`);
    }

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
      // STEP 3: Pure Node Subject Extraction Masking
      let subjectMaskUrl: string | undefined = undefined;
      let maskBuffer: Buffer | undefined = undefined;
      try {
        maskBuffer = await extractSubjectMask(baseImageResult.imageBuffer);
        
        logger.info('Uploading transparent subject mask cutout to storage...');
        const maskUploadResult = {
          imageBuffer: maskBuffer,
          metadata: {
            model: 'ONNX Subject Extractor',
            dimensions: { width: 1080, height: 1080 },
            prompt: 'transparent subject mask'
          }
        };
        subjectMaskUrl = await uploadImageToStorage(maskUploadResult, `posts/${postId}/mask/`);
        logger.info(`✓ Subject mask uploaded successfully. URL: ${subjectMaskUrl}`);
      } catch (maskErr: any) {
        logger.error(`Subject mask extraction or upload skipped/failed: ${maskErr.message}. Gracefully degrading to standard 2D compositing.`);
      }

      // STEP 4: Deterministic Saliency Grid Occupancy check with Subject Collision Avoidance
      logger.info('Executing saliency grid layout reasoning...');
      const baseSaliency = await analyzeImageSaliency(baseImageResult.imageBuffer);
      let safestQuadrant = baseSaliency.safestQuadrant;

      if (maskBuffer) {
        try {
          logger.info('Analyzing subject cutout mask saliency to prevent text-subject collision...');
          const maskSaliency = await analyzeImageSaliency(maskBuffer);
          
          let minScore = Infinity;
          let bestQuad = safestQuadrant;
          const finalQuadrantScores: Record<string, number> = {};

          for (const quad of Object.keys(baseSaliency.quadrantScores)) {
            const baseScore = baseSaliency.quadrantScores[quad] || 0;
            const maskScore = maskSaliency.quadrantScores[quad] || 0;

            // If a quadrant has more than 1.5% solid subject cutout coverage, penalize it heavily.
            // This prevents placing text overlays directly over the main subject product/furniture.
            const penalty = maskScore > 0.015 ? 10.0 + maskScore * 5.0 : 0.0;

            // Apply spatial bias to prefer top/center zones for product layouts
            let biasPenalty = 0.0;
            if (quad.startsWith('bottom')) {
              biasPenalty = 0.35;
            } else if (quad === 'center') {
              biasPenalty = 0.05;
            }

            const combinedScore = baseScore + penalty + biasPenalty;
            finalQuadrantScores[quad] = combinedScore;

            logger.info(`Quadrant '${quad}' -> Base: ${baseScore.toFixed(3)}, Subject Occupancy: ${(maskScore * 100).toFixed(1)}%, Penalty: ${penalty.toFixed(3)}, Bias: ${biasPenalty.toFixed(2)}, Combined: ${combinedScore.toFixed(3)}`);

            if (combinedScore < minScore) {
              minScore = combinedScore;
              bestQuad = quad as any;
            }
          }

          safestQuadrant = bestQuad;
          // Store final scores for the LLM to use
          (baseSaliency as any).finalQuadrantScores = finalQuadrantScores;
          logger.info(`✓ Saliency collision-resolver solved safest quadrant: '${safestQuadrant}' (Score: ${minScore.toFixed(3)})`);
        } catch (maskSalErr: any) {
          logger.error(`Subject mask saliency analysis failed: ${maskSalErr.message}. Falling back to visual-only saliency.`);
        }
      }

      // STEP 5: Relative luminance localized color contrast solve (preliminary pass for safest quadrant)
      logger.info(`Running color sampling for safe zone: ${safestQuadrant}`);
      const colorMetrics = await analyzeLocalColors(baseImageResult.imageBuffer, safestQuadrant, 8);

      // STEP 5.4: Copy Director Pass (LLM copywriter)
      logger.info('Invoking Copy Director to extract structural text nodes...');
      const copyBlueprint = await generateAdCopyBlueprint({
        topic: post.topic || undefined,
        caption: post.caption || undefined,
        contentPillar: post.contentPillar || (post.metadata as any)?.contentPillar || undefined,
        brandName: brandName,
        industry: campaign?.industry || 'Lifestyle',
        tone: campaign?.tone || campaign?.strategy?.tone || undefined
      });

      // STEP 5.5: Double-pass Layout Director pass (LLM layout solver)
      let layoutBlueprint = undefined;
      try {
        layoutBlueprint = await generateLayoutBlueprint({
          imagePrompt: post.imagePrompt,
          industry: campaign?.industry || 'Lifestyle',
          services: campaign?.services || [],
          baseColor: campaign?.brandColor || '#000000',
          accentColor: campaign?.accentColor || undefined,
          geography: campaign?.geography || undefined,
          safestQuadrant,
          quadrantScores: (baseSaliency as any).finalQuadrantScores || baseSaliency.quadrantScores,
          contrastMetrics: {
            isDarkBg: colorMetrics.isDarkBg,
            headlineColor: colorMetrics.headlineColor,
            subtitleColor: colorMetrics.subtitleColor,
            averageColorHex: colorMetrics.averageColorHex,
            averageColorName: colorMetrics.averageColorName
          },
          canvasDimensions: { 
            width: baseImageResult.metadata?.dimensions?.width || 1080, 
            height: baseImageResult.metadata?.dimensions?.height || 1080 
          },
          slideIndex: undefined,
          feedback: feedback,
          copyBlueprint: copyBlueprint
        });
      } catch (bpErr: any) {
        logger.error(`Layout Director execution skipped/failed: ${bpErr.message}. Proceeding with standard layout variables.`);
      }

      // STEP 5.6: Double-pass contrast-safe colors resampling & Z-Index depth analysis
      const chosenQuadrant = safestQuadrant; // Strictly lock placement to the consistent CV engine's solved safest zone
      logger.info(`Resampling local color contrast for final chosen quadrant: ${chosenQuadrant}`);
      const finalColorMetrics = await analyzeLocalColors(baseImageResult.imageBuffer, chosenQuadrant, 8);

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

      // Determine final typography Z-Index programmatically to avoid sliced/clipped text
      let typographyZIndex: 'behind' | 'in_front' = 'in_front'; // Safe default
      if (layoutBlueprint) {
        // Enforce safe sandwiching stacking: only stack 'behind' the subject cutout if:
        // 1. The LLM Layout Director suggested 'behind' AND
        // 2. The subject overlap is reasonable (between 1% and 25%) to preserve complete legibility
        //    without fully drowning the text, allowing the letters to wrap around the subject.
        // 3. For card-based layouts, keeping them behind looks blocky and cuts through the subject artificially,
        //    so we restrict the Z-depth sandwich primarily to borderless floating designs (requireGlassmorphism === false)
        //    or highly translucent cards (opacity < 0.4).
        
        const isBorderless = layoutBlueprint.requireGlassmorphism === false;
        const isTranslucentCard = layoutBlueprint.requireGlassmorphism === true && (!layoutBlueprint.backgroundColorOverride || layoutBlueprint.backgroundColorOverride.includes('0.'));
        
        const isEligibleForDepth = isBorderless || isTranslucentCard;
        const hasReasonableOverlap = cutoutOverlap >= 0.001 && cutoutOverlap <= 0.35;

        if (layoutBlueprint.typographyZIndex === 'behind' && isEligibleForDepth && hasReasonableOverlap) {
          typographyZIndex = 'behind';
          logger.info(`3D Depth Sandwiching APPROVED: Typography will render BEHIND subject (overlap: ${(cutoutOverlap * 100).toFixed(1)}%)`);
        } else {
          typographyZIndex = 'in_front';
          logger.info(`3D Depth Sandwiching DEACTIVATED: Typography forced IN FRONT of subject to protect legibility/framing (overlap: ${(cutoutOverlap * 100).toFixed(1)}%, borderless: ${isBorderless}, translucentCard: ${isTranslucentCard})`);
        }
        layoutBlueprint.typographyZIndex = typographyZIndex;
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
          logger.info(`[Carousel] Isolating transparent subject cutout mask...`);
          let slideMaskUrl = '';
          try {
            const maskBuffer = await extractSubjectMask(slideImageResult.imageBuffer);
            const maskUploadResult = {
              imageBuffer: maskBuffer,
              metadata: {
                model: `rembg-wasm`,
                dimensions: { width: adWidth, height: adHeight },
                prompt: slidePrompts[slideIdx]
              }
            };
            slideMaskUrl = await uploadImageToStorage(maskUploadResult, `posts/${postId}/slide_${slideIdx}_mask/`);
            logger.info(`[Carousel] Subject mask uploaded successfully: ${slideMaskUrl}`);
          } catch (maskErr) {
            logger.warn(`[Carousel] Mask extraction skipped: ${maskErr}`);
          }

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
            baseColor: campaign?.brandColor || '#8B5CF6',
            accentColor: campaign?.accentColor || undefined,
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
            brandColor: campaign?.brandColor || undefined,
            accentColor: campaign?.accentColor || undefined,
            geography: campaign?.geography || undefined,
            industry: campaign?.industry || undefined,
            topic: post.topic || undefined,
            copyElements: slideCopyBlueprint?.elements || [],
            layoutBlueprint: {
              ...slideBlueprint,
              dynamicHtmlBlock: undefined // Force native compositor fallback
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
            const ctaEl = copyBlueprint?.elements?.find(e => e.type === 'cta');
            if (!ctaEl) return cta;
            const iconHtml = ctaEl.iconName ? `<i data-lucide="${ctaEl.iconName}" style="width: 16px; height: 16px; margin-right: 2px;"></i>` : '';
            return `${iconHtml} ${ctaEl.text}`.trim();
          })(),
          quadrant: chosenQuadrant,
          colors: finalColorMetrics,
          width: adWidth,
          height: adHeight,
          brandColor: campaign?.brandColor || undefined,
          accentColor: campaign?.accentColor || undefined,
          geography: campaign?.geography || undefined,
          industry: campaign?.industry || undefined,
          topic: post.topic || undefined,
          copyElements: copyBlueprint?.elements || [],
          layoutBlueprint: layoutBlueprint ? {
            ...layoutBlueprint,
            dynamicHtmlBlock: undefined, // Force native compositor fallback for pixel-perfect overlays
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
