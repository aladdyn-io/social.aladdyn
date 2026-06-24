/**
 * Image Prompt Generator Service
 *
 * Uses OpenAI (or Groq) to generate detailed, text-free background image prompts.
 */

import { CalendarItem, Strategy } from '../types/content';
import { NormalizedInput } from './normalizeInput';
import { callLlm } from '../utils/llmClient';
import { getFriendlyColorName, getGeographyVisualCues } from './audienceClassifier';

const hasOpenAiKey = !!process.env.OPENAI_API_KEY;
const isOpenAiDisabled =
  process.env.OPENAI_DISABLED === 'true' ||
  process.env.AI_DISABLED === 'true' ||
  !hasOpenAiKey;

/**
 * Specifies WHERE in the image the AI should leave empty negative space
 * so the HTML compositor can place text overlays without obscuring subjects.
 *
 * - `left_column`  → blank left 50% (default; subjects on right)
 * - `right_column` → blank right 50% (subjects on left)
 * - `top_band`     → blank top 40% (subjects on bottom)
 * - `bottom_band`  → blank bottom 40% (subjects on top)
 * - `center_clear` → blank center (subjects on edges)
 */
export type NegativeSpaceZone =
  | 'left_column'
  | 'right_column'
  | 'top_band'
  | 'bottom_band'
  | 'center_clear';

export async function generateDetailedImagePrompt(
  item: CalendarItem,
  strategy: Strategy,
  normalized: NormalizedInput,
  feedback?: string,
  preferredLayout?: string,
  negativeSpaceZone?: NegativeSpaceZone
): Promise<string> {
  if (isOpenAiDisabled) {
    return generateFallbackPrompt(item, normalized);
  }

  const topicLower = (item.topic || '').toLowerCase();
  const indLower = (normalized.industry || '').toLowerCase();
  const baseColorDesc = getFriendlyColorName(normalized.base_color);
  const accentColorDesc = getFriendlyColorName(normalized.accent_color);
  const geoVisualCues = getGeographyVisualCues(normalized.geography);

  const productKeywords = ['product', 'shop', 'store', 'e-commerce', 'retail', 'brand', 'packaging', 'bottle', 'jar', 'box', 'cream', 'cosmetic', 'serum', 'oil', 'shampoo', 'soap', 'perfume', 'supplement', 'food', 'beverage', 'drink', 'snack', 'coffee', 'tea', 'juice', 'clothing', 'apparel', 'fashion', 'jewelry', 'accessory', 'shoe', 'bag', 'watch', 'gadget', 'device', 'phone', 'laptop', 'furniture', 'decor', 'candle', 'plant', 'flower', 'gift', 'toy', 'pet'];
  const isPhysicalBrand = productKeywords.some(kw => indLower.includes(kw));
  
  // If it is a physical brand but the topic is community, trust, lifestyle, thank you, review, or unlock potential, we still want a human lifestyle shot!
  const humanTopicKeywords = ['community', 'trust', 'review', 'thank', 'people', 'team', 'expert', 'lifestyle', 'learn', 'grow', 'success', 'potential', 'dream', 'achieve', 'our story', 'join', 'together'];
  const isHumanTopic = humanTopicKeywords.some(kw => topicLower.includes(kw));

  const needLifestyle = !isPhysicalBrand || isHumanTopic;
  const ethnicity = normalized.geography.toLowerCase().includes('india') ? 'South Asian' : 'East Asian/multicultural';

  const layout = preferredLayout || (needLifestyle ? 'editorial_left_bleed' : 'classic');

  // Resolve the effective negative space zone from explicit param or layout hint
  const effectiveZone: NegativeSpaceZone = negativeSpaceZone || (
    layout === 'editorial_left_bleed' ? 'left_column' :
    layout === 'editorial_right_bleed' ? 'right_column' :
    layout.includes('top') ? 'top_band' :
    layout.includes('bottom') ? 'bottom_band' :
    'left_column' // safe default
  );

  // Zone-specific spatial mandate text (used in both lifestyle and product directions)
  const zoneSpatialMandate: Record<NegativeSpaceZone, { subjectSide: string; emptyZone: string; emptyDesc: string; bodyNegative: string }> = {
    left_column: {
      subjectSide: 'RIGHT 55% (rightmost half of the frame only)',
      emptyZone: 'LEFT 45%',
      emptyDesc: 'a simple plain flat wall, quiet empty smooth room partition, or neutral clean studio backdrop',
      bodyNegative: 'CRITICAL: Absolutely NO part of any human body — including head, face, shoulders, arms, hands, or legs — may appear in the LEFT 45% of the frame. The leftmost 45% is reserved exclusively for an empty wall/backdrop. Any person must be fully contained within the rightmost 55%, with their head and shoulders well inside the right half.',
    },
    right_column: {
      subjectSide: 'LEFT 55% (leftmost half of the frame only)',
      emptyZone: 'RIGHT 45%',
      emptyDesc: 'a simple plain flat wall or neutral clean studio backdrop on the right side',
      bodyNegative: 'CRITICAL: Absolutely NO part of any human body — including head, face, shoulders, arms, hands, or legs — may appear in the RIGHT 45% of the frame. The rightmost 45% is reserved exclusively for an empty wall/backdrop.',
    },
    top_band: {
      subjectSide: 'BOTTOM 60%',
      emptyZone: 'TOP 40%',
      emptyDesc: 'a clean open sky, soft ceiling, or neutral overhead backdrop',
      bodyNegative: 'CRITICAL: Absolutely NO part of any human body — no heads, faces, raised arms, or torsos — may appear in the TOP 40% of the frame. All people must be fully below the midpoint of the image.',
    },
    bottom_band: {
      subjectSide: 'TOP 60%',
      emptyZone: 'BOTTOM 40%',
      emptyDesc: 'a clean empty floor, soft ground plane, or neutral lower backdrop',
      bodyNegative: 'CRITICAL: Absolutely NO part of any human body — no legs, feet, or seated lower halves — may appear in the BOTTOM 40% of the frame. All people must be fully in the upper portion of the image.',
    },
    center_clear: {
      subjectSide: 'OUTER EDGES (left and right thirds)',
      emptyZone: 'CENTER THIRD',
      emptyDesc: 'a clean, open, uncluttered center zone with no subjects, props, or details',
      bodyNegative: 'CRITICAL: Absolutely NO part of any human body may appear in the CENTER THIRD of the frame. All subjects must be pushed to the outer left and right edges of the composition.',
    },
  };

  const zoneMandate = zoneSpatialMandate[effectiveZone];

  // Zone-specific HTML compositor instruction
  const zoneCompositorNote: Record<NegativeSpaceZone, string> = {
    left_column: `The HTML Renderer will overlay a white/light-gradient column on the LEFT 45% of the canvas. Therefore, the LEFT 50% of the image MUST be extremely bright, light, and soft (soft off-white, light warm cream plaster) with absolutely zero dark corners, strong shadows, or colored highlights. This guarantees readability of the dark charcoal text.`,
    right_column: `The HTML Renderer will overlay a text panel on the RIGHT 45% of the canvas. Therefore, the RIGHT 50% of the image MUST be extremely bright, light, and soft with absolutely zero dark corners or strong shadows.`,
    top_band: `The HTML Renderer will overlay a text band across the TOP 40% of the canvas. Therefore, the TOP 40% of the image MUST be extremely bright, light, and soft — like an open sky or clean ceiling — with no dark corners or heavy shadows.`,
    bottom_band: `The HTML Renderer will overlay a text band across the BOTTOM 40% of the canvas. Therefore, the BOTTOM 40% of the image MUST be extremely bright, light, and soft — like a clean floor or neutral lower backdrop — with no dark corners or heavy shadows.`,
    center_clear: `The HTML Renderer will overlay floating text in the CENTER THIRD of the canvas. Therefore, the CENTER THIRD of the image MUST be completely open, clean, and uncluttered — no subjects, props, or details in the center zone.`,
  };

  const layoutInstructions = `- EXPLICIT HTML COMPOSITOR REQUIREMENT: ${zoneCompositorNote[effectiveZone]}`;

  let visualDirectionStr = '';
  if (needLifestyle) {
    visualDirectionStr = `VISUAL DIRECTION: HIGH-END LIFESTYLE PHOTOGRAPHY (Human-centric)
- The image MUST be a premium, high-quality, photorealistic photograph featuring real people.
- Main subject: ${ethnicity} people representing the target audience matching the post topic: "${item.topic}".
- SHOT FRAMING MANDATE (CRITICAL): Shoot the scene as a WIDE-ANGLE ROOM-SCALE PHOTOGRAPH. The camera must be placed far enough from the subject that the ENTIRE PERSON — from head to feet — is visible within the frame. Think of it as a furniture/interior magazine spread where you see the whole room and the person in it. Acceptable framings: full-length standing portrait, 3/4 body shot showing head to knee, wide-room lifestyle shot. FORBIDDEN framings: desk-level close-up showing only hands/arms/torso, tight crop of laptop keyboard, any composition where the person's head is out of frame or cut off at the top.
- SPATIAL SPLIT MANDATE (CRITICAL FOR TEXT OVERLAY): All human subjects, laptops, props, furniture, plants, windows, and detailed active elements MUST be placed strictly on the ${zoneMandate.subjectSide} of the frame. The full silhouette of the person — including their head and face — must be entirely within ${zoneMandate.subjectSide}.
- BODY CLEARANCE MANDATE — ABSOLUTE RULE: ${zoneMandate.bodyNegative}
- NEGATIVE SPACE MANDATE (ABS-PROPRIETARY): The entire ${zoneMandate.emptyZone} of the frame MUST be completely blank, empty, clean, flat, uncluttered, and neutral negative space (e.g., ${zoneMandate.emptyDesc} in the brand base color: ${baseColorDesc}). There must be absolutely no furniture, no lamps, no TV, no windows, no plants, and no decorations in the ${zoneMandate.emptyZone} of the image. The composition must transition from a clean, blank empty surface in the ${zoneMandate.emptyZone} to active subjects in the ${zoneMandate.subjectSide}.
- FLUX NEGATIVE PROMPT (APPEND TO END OF GENERATED PROMPT): End the prompt with this exact sentence: "Negative: cropped, partial body, headless figure, no face visible, desk-level angle, extreme close-up of hands, cut-off head, torso only, disembodied limbs, missing head."`;
  } else {
    visualDirectionStr = `VISUAL DIRECTION: PREMIUM STAGED PRODUCT SHOWCASE (Product-centric)
- The image MUST be a professional product showcase with premium staged product packaging or containers on an elegant minimalist surface or pedestal.
- SPATIAL SPLIT MANDATE (CRITICAL FOR TEXT OVERLAY): The product pedestal, packaging, staging elements, plants, and background details MUST be positioned strictly on the ${zoneMandate.subjectSide} of the frame.
- NEGATIVE SPACE MANDATE (ABS-PROPRIETARY): The entire ${zoneMandate.emptyZone} of the frame MUST be completely blank, flat, uncluttered, neutral, and empty negative space (e.g. ${zoneMandate.emptyDesc} in the brand base color: ${baseColorDesc}). There must be absolutely no detailed props, shadows, panels, or items in the ${zoneMandate.emptyZone} of the image.`;
  }

  let feedbackSection = '';
  if (feedback) {
    feedbackSection = `\nUSER FEEDBACK / DIRECTIONS (You MUST follow these specific instructions and modify/refine the visual prompt according to them):\n"${feedback}"\n`;
  }

  const userPrompt = `Create a detailed visual prompt for an AI image generator (like FLUX or DALL-E) to produce a text-free social media background scene.

${visualDirectionStr}

BRAND COLOR INTEGRATION & HARSHNESS FORBIDDEN LAW (CRITICAL DESIGN RULE):
- NO HARSH SOLID-COLORED ROOMS: If a brand's base color (${baseColorDesc} / ${normalized.base_color}) is bright, highly saturated, or vibrant (like neon, bright red, orange, strong yellow, or deep purple), you MUST NEVER paint the entire room, the walls, the flooring, or the ambient lighting in this solid color (e.g. no "solid red rooms" or "solid orange saunas" or "solid pink caves"). It looks extremely cheap, harsh, and amateur, and makes overlaying text completely impossible.
- SOPHISTICATED NEUTRAL DOMINANT SURFACES: Large main surfaces of the scene (like dominant backdrop walls, partitions, countertops, flooring, and ceilings) MUST be styled in elegant, high-end neutral design materials: soft warm plaster, luxury warm cream, muted light travertine stone, off-white sand plaster, or soft grey limestone. This creates a calm, breathing negative space in the ${zoneMandate.emptyZone}.
- ELITE SPOTLIGHT ACCENTS: Integrate the brand base color (${baseColorDesc} / ${normalized.base_color}) and accent color (${accentColorDesc} / ${normalized.accent_color}) strictly as meticulous, elegant localized accents, visual highlights, or props on the ${zoneMandate.subjectSide} of the image (e.g., the packaging label of a product, a single designer vase, a throw pillow, a floral arrangement, or a soft fabric detail). They must feel integrated like a real high-end magazine shoot, not forced.

LAYOUT-DRIVEN CONTRAST AWARENESS (THE HTML RENDERING COMPOSITOR'S SAY):
${layoutInstructions}
- The layout director requires a highly clean, calm margin on the ${zoneMandate.emptyZone} for high-fashion typography:
  * For standard Light layouts (default): Ensure the ${zoneMandate.emptyZone} is extremely bright, light, and soft (e.g., sun-drenched warm plaster or light cream stone) with zero dark corners, heavy shadows, or deep heavy colors.
  * For Dark layouts: Keep the ${zoneMandate.emptyZone} clean, dark, and muted.

Business Industry: ${normalized.industry}
Target Geography: ${normalized.geography}
Services Offered: ${normalized.services.join(', ')}
Post Topic: ${item.topic}
Content Pillar: ${item.pillar}
Is Festival: ${item.is_festival}${item.is_festival ? ' (' + item.festival_name + ')' : ''}
Tone: ${strategy.tone}
${feedbackSection}

Generate a comprehensive visual prompt (150-300 words) covering:
1. Main Visual Concept & Subject: Describe the main scene. MANDATORY: describe the camera as placed far from the subject — a wide room-scale shot. The person must be shown HEAD-TO-TOE or at minimum HEAD-TO-WAIST with their face clearly visible. Describe the room/studio layout, not just the desk surface. Examples of correct framing: "A young professional sitting at a minimal desk in the corner of a bright airy studio, photographed from across the room, full body visible". NEVER describe only hands on keyboard, NEVER describe a close-up of a desk surface.
2. Location Staging Motifs: Incorporate these culturally/geographically appropriate visual elements: ${geoVisualCues}.
3. Spatial Composition: Enforce the 1:1 square format. The main subject (with clearly visible head/face) is entirely on the ${zoneMandate.subjectSide}. The ${zoneMandate.emptyZone} is a clean, uncluttered empty wall/backdrop with ZERO body parts or furniture intruding.
4. Lighting & Atmosphere: Cinematic soft diffused lighting, warm natural sunlight, casting elegant soft shadows, keeping the light clean and natural without any colored neon filters or saunas.
5. Color Scheme: Dominated by elegant neutral tones (warm cream, soft beige, or travertine stone) with high-fashion accents of the brand base color (${baseColorDesc}) and accent color (${accentColorDesc}) integrated strictly as localized highlights.
6. Style & Mood: Modern, sophisticated, high-end visual design, premium luxury look.
7. End the prompt with this exact negative constraint sentence: "Negative: cropped body, headless figure, no visible face, desk-level angle, extreme close-up of hands only, missing head, disembodied limbs, partial torso only."

CRITICAL TEXT-FREE & HALLUCINATION NEGATIVE CONSTRAINTS:
1. The generated prompt MUST be completely text-free. Never use any literal words in quotes, letters, or words inside the prompt description.
2. Do NOT mention the festival name (e.g., 'Bakrid'), percentages (e.g., '15%', '15', 'percent'), or copy terms (e.g., 'discount', 'sale', 'off') anywhere in your output prompt.
3. Translate thematic festivals and discounts into raw, text-free visual staging elements and physical motifs.
4. Explicitly dictate in the prompt that there should be absolutely NO text, labels, words, letters, signage, numbers, or logos in the generated image.

Output ONLY the prompt, no explanations.`;

  const response = await callLlm({
    model: process.env.IMAGE_PROMPT_MODEL || process.env.LLM_MODEL || 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: 'You are an expert graphic designer and social media visual specialist. Create detailed AI image generation prompts for clean, text-free background assets.',
      },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.8,
    max_tokens: 500,
  });

  const prompt = response.choices[0]?.message?.content?.trim();
  if (!prompt) throw new Error('Empty response from LLM');
  return prompt;
}

function generateFallbackPrompt(item: CalendarItem, normalized: NormalizedInput): string {
  console.warn('[ImagePrompt] Using fallback template prompt');
  const base = item.is_festival
    ? `Professional social media background photograph representing serene cultural elegance. Topic: Staged premium product showcase with elegant crescent metallic motifs, warm luxury ambiance, clean setting.`
    : `Professional social media background photograph for ${normalized.industry} brand. Topic: Staged product packaging on a circular marble pedestal. Modern, clean, professional setting.`;

  return `${base}

BRANDING: Colors ${normalized.accent_color} and ${normalized.base_color}. Font: ${normalized.font_style}.
COMPOSITION: Square 1:1 format. Clear focal point, rule of thirds. Ensure a clean, empty quadrant (e.g., top-left or bottom-left) for dynamic text box overlay.
LIGHTING: Natural, bright, professional. Warm color temperature.
NEGATIVE CONSTRAINT: Absolutely NO text, words, letters, signage, or logos in the image. A pure, pristine background scene only.
FORMAT: High quality, social media ready, eye-catching.`;
}

export async function generateDetailedImagePrompts(
  calendar: CalendarItem[],
  strategy: Strategy,
  normalized: NormalizedInput,
  negativeSpaceZone?: NegativeSpaceZone
): Promise<Map<string, string>> {
  const prompts = new Map<string, string>();
  console.log(`[ImagePrompt] Generating prompts for ${calendar.length} posts...`);

  for (const [i, item] of calendar.entries()) {
    try {
      console.log(`[ImagePrompt] [${i + 1}/${calendar.length}] ${item.topic}`);
      prompts.set(item.date, await generateDetailedImagePrompt(item, strategy, normalized, undefined, undefined, negativeSpaceZone));
    } catch {
      prompts.set(item.date, generateFallbackPrompt(item, normalized));
    }
  }

  console.log(`[ImagePrompt] Done: ${prompts.size} prompts`);
  return prompts;
}
