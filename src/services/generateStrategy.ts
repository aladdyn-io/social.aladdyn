/**
 * Upgraded Content Strategy Generation Service
 *
 * Refactored into a high-fidelity multi-agent sequence matching the Python pipeline:
 * 
 * 1. Brand Intelligence Pass: Analyzes brand inputs & scraped content to infer 
 *    industry vertical, brand voice tone, archetype, visual styling rules, 
 *    and buyer sophistication level (1-5).
 * 2. Audience Persona Pass: Formulates distinct psychographic and behavioral 
 *    customer personas, preferred platforms, and specific buying triggers.
 * 3. Platform Strategy Pass: Selects 1-3 prioritized social platforms and
 *    frequency/windows recommendations (Instagram, LinkedIn, WhatsApp).
 * 4. Campaign Strategy Pass: Synthesizes brand, personas, and platform rules into 
 *    chronological temporal campaign phases (Early/Mid/Late), messaging strategies, 
 *    and content mixes.
 *
 * Persists the resulting strategy details inside the SocialStrategy table fields.
 */

import { Strategy, CampaignPhase } from '../types/content';
import { NormalizedInput } from './normalizeInput';
import { callLlm } from '../utils/llmClient';
import cache, { CacheTTL } from './cache';
import { createLogger } from '../utils/logger';
import { inferAudienceType } from './audienceClassifier';

const logger = createLogger({ service: 'strategy-agent-sequence' });
const isOpenAiDisabled =
  process.env.OPENAI_DISABLED === 'true' ||
  process.env.AI_DISABLED === 'true' ||
  !process.env.OPENAI_API_KEY;

const buildFallbackStrategy = (input: NormalizedInput): Strategy => {
  const pillars = [
    `${input.industry} insights`,
    'Customer stories',
    'Tips and how-to',
    'Offers and promotions',
  ];

  const totalDays = input.total_days || 7;
  const needsPhases = totalDays >= 14;
  const midpoint = Math.max(1, Math.floor(totalDays / 2));

  return {
    content_pillars: pillars.slice(0, 4),
    tone: 'professional, warm, and helpful',
    cta_style: 'Learn more about our services and how we can help',
    content_mix: { education: 50, trust: 30, promotion: 20 },
    campaign_phases: needsPhases
      ? [
          {
            dayRange: [1, midpoint],
            focus: 'awareness',
            contentMixOverride: { education: 60, trust: 30, promotion: 10 },
            guidance: 'Introduce the brand, highlight expertise, and build familiarity.',
          },
          {
            dayRange: [midpoint + 1, totalDays],
            focus: 'conversion',
            contentMixOverride: { education: 30, trust: 40, promotion: 30 },
            guidance: 'Show proof, invite inquiries, and highlight offers.',
          },
        ]
      : undefined,
  };
};
const logger = createLogger({ service: 'strategy-agent-sequence' });

/**
 * Legacy Sequential Wrapper
 * If called directly (e.g. without the Staged State Machine), executes all 
 * 4 modular agents in a single sequential pass.
 */
export async function generateStrategy(
  input: NormalizedInput,
  websiteContext?: string
): Promise<Strategy> {
  const cacheKey = `strategy:${input.industry}:${input.brand_stage}:${input.geography}`;

  const cached = cache.get<Strategy>(cacheKey);
  if (cached) {
    logger.info(`[Strategy] Cache hit for campaign: ${input.industry}/${input.geography}`);
    return cached;
  }

  if (isOpenAiDisabled) {
    const fallback = buildFallbackStrategy(input);
    cache.set(cacheKey, fallback, CacheTTL.STRATEGY);
    logger.warn('[Strategy] OpenAI disabled — using fallback strategy');
    return fallback;
  }

  logger.info(`Starting legacy single-pass strategy pipeline for industry: ${input.industry}`);

  // ── PASS 1: Brand Intelligence Agent ────────────────────────────────────
  const brandProfile = await runBrandIntelligence(input, websiteContext);
  
  // ── PASS 2: Audience Persona Agent ──────────────────────────────────────
  const audiencePersonas = await runAudiencePersona(brandProfile);
  
  // ── PASS 3: Platform Strategy Agent ─────────────────────────────────────
  const platformStrategy = await runPlatformStrategy(brandProfile, audiencePersonas);

  // ── PASS 4: Campaign Strategy & Phases Agent ────────────────────────────
  const strategy = await runCampaignStrategy(input, brandProfile, audiencePersonas, platformStrategy);

  // Cache and return completed strategy
  cache.set(cacheKey, strategy, CacheTTL.STRATEGY);
  logger.info(`[Strategy] Multi-agent generation complete for ${input.industry}`);
  return strategy;
}

/**
 * Stage 1: Brand Intelligence Agent
 * Infers archetype, visual styling rules, content pillars, and buyer sophistication.
 */
export async function runBrandIntelligence(
  input: NormalizedInput,
  websiteContext?: string
): Promise<any> {
  logger.info('Running Stage 1: Brand Intelligence Agent...');

  const websiteSection = websiteContext 
    ? `\nScraped website intelligence context:\n${websiteContext}\n`
    : '';

  const prompt = `You are a Brand Intelligence Analyst. Your job is to analyze company information and produce a structured brand profile.

Given a company name, description, geography, business goals, and brand colors, infer the brand's identity and output a BrandProfile JSON object.

OUTPUT RULES:
- Output ONLY a valid JSON OBJECT. Not an array. Not prose. Not markdown.
- Every field is required. Do not omit any field.
- Be specific and concrete. Avoid generic answers like "professional" or "modern".
- Infer from context when information is not explicitly stated.

REQUIRED OUTPUT FORMAT (copy this structure exactly):
{
  "industry": "B2B SaaS — finance automation",
  "tone": "authoritative and trustworthy with a pragmatic edge",
  "brand_archetype": "sage",
  "visual_style": "clean corporate with teal accents — data-forward, minimal clutter",
  "buyer_sophistication": 4,
  "content_pillars": ["ROI and efficiency proof", "finance team education", "customer success stories"],
  "target_audience": ["CFOs and finance directors at mid-size companies", "AP managers and controllers"],
  "pain_points": ["Manual invoice processing is slow and error-prone", "Lack of real-time AP visibility causes cash flow surprises"]
}

Company Info:
Industry: ${input.industry}
Services: ${input.services.join(', ')}
Geography: ${input.geography}
Brand Stage: ${input.brand_stage}
${websiteSection}

FIELD GUIDELINES:
- industry: specific vertical, e.g. "B2B SaaS", "D2C skincare", "fintech payments"
- tone: brand voice, e.g. "premium and authoritative", "playful and energetic", "warm and empathetic"
- brand_archetype: Provide a custom, descriptive archetype or persona that perfectly captures the brand's unique identity (e.g., "rebellious innovator", "minimalist luxury guru", "warm everyday caregiver"). Do NOT restrict yourself to traditional archetypes.
- visual_style: e.g. "editorial minimalist", "bold and vibrant", "clean corporate", "warm lifestyle"
- buyer_sophistication: integer 1–5 (1=mass market impulse buyer, 3=informed consumer, 5=expert/enterprise buyer)
- content_pillars: 3–5 thematic content categories
- target_audience: 2–4 specific audience segments
- pain_points: 3–5 specific problems the target audience faces that this brand solves`;

  const completion = await callLlm({
    model: process.env.STRATEGY_MODEL || process.env.LLM_MODEL || 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: 'You are a Brand Intelligence Analyst. Your job is to analyze company info and output ONLY a valid JSON object representing a BrandProfile. No markdown, no prose.'
      },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.5
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error('Brand Intelligence Agent returned empty response');
  
  return JSON.parse(raw);
}

/**
 * Stage 2: Audience Persona Agent
 * Formulates detailed psychographics and buying triggers for audience segments.
 */
export async function runAudiencePersona(brandProfile: any): Promise<any> {
  logger.info('Running Stage 2: Audience Persona Agent...');

  const prompt = `You are an Audience Research Specialist. Your job is to generate distinct, behaviorally-specific audience personas from a brand profile.

Given a BrandProfile JSON, generate 2–4 audience personas that represent the brand's key customer segments.

OUTPUT RULES:
- Output ONLY a valid JSON OBJECT. Not an array. Not prose. Not markdown.
- The root of your response MUST be an object with a single key: "personas"
- "personas" contains an array of persona objects.
- Generate exactly 2–4 personas. Each must be behaviorally distinct.
- Focus on psychographics and buying behavior, not just demographics.
- Be specific. Avoid generic descriptions like "busy professionals".

REQUIRED OUTPUT FORMAT (copy this structure exactly):
{
  "personas": [
    {
      "name": "The Bootstrapped Founder",
      "pain_points": ["specific problem 1", "specific problem 2", "specific problem 3"],
      "preferred_platforms": ["linkedin", "instagram"],
      "buying_triggers": ["trigger 1", "trigger 2", "trigger 3"],
      "content_preferences": ["case studies", "short how-to videos", "founder stories"]
    }
  ]
}

BrandProfile:
${JSON.stringify(brandProfile, null, 2)}

PERSONA GUIDELINES:
- Name: use a descriptive archetype label that captures the persona's mindset.
- Pain points: tie directly to the brand's industry and the problems it solves.
- Preferred platforms: only use values from: linkedin, instagram, whatsapp
- Buying triggers: include both rational (ROI, efficiency) and emotional (fear, status) triggers.
- Content preferences: match to the persona's sophistication level and platform behavior.
- Make each persona meaningfully different — different roles, motivations, and objections.`;

  const completion = await callLlm({
    model: process.env.STRATEGY_MODEL || process.env.LLM_MODEL || 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: 'You are an Audience Research Specialist. Generate behaviorally-specific customer segments based on brand profiles. Return ONLY valid JSON, no markdown.'
      },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.6
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error('Audience Persona Agent returned empty response');
  
  return JSON.parse(raw);
}

/**
 * Stage 3: Platform Strategy Agent
 * Selects and prioritizes 1-3 social platforms from supported platforms: linkedin, instagram, whatsapp.
 */
export async function runPlatformStrategy(
  brandProfile: any,
  audiencePersonaSet: any
): Promise<any> {
  logger.info('Running Stage 3: Platform Strategy Agent...');

  const audienceType = inferAudienceType(brandProfile.industry, brandProfile.brand_archetype);
  logger.info(`Inferred audience type: ${audienceType.toUpperCase()} for platform selection`);

  const prompt = `You are a Social Media Strategist. Your job is to select and prioritize the right social platforms for a brand based on its profile and audience.

Given a BrandProfile and AudiencePersonaSet JSON, select 1–3 platforms and define the posting strategy for each.

OUTPUT RULES:
- Output ONLY a valid JSON OBJECT. Not an array. Not prose. Not markdown.
- The root of your response MUST be an object with a single key: "platforms"
- "platforms" contains an array of platform objects.
- Select 1–3 platforms. Priority 1 = highest priority.

SUPPORTED PLATFORMS: linkedin, instagram, whatsapp
Do NOT suggest any other platforms. Only select from these three.

REQUIRED OUTPUT FORMAT (copy this structure exactly):
{
  "platforms": [
    {
      "platform": "linkedin",
      "priority": 1,
      "posting_frequency": 5,
      "content_types": ["carousel", "thought leadership post", "case study"],
      "best_posting_windows": ["Tuesday 9am-11am", "Thursday 6pm-8pm"]
    },
    {
      "platform": "instagram",
      "priority": 2,
      "posting_frequency": 5,
      "content_types": ["single image", "reel", "story"],
      "best_posting_windows": ["Monday 11am-1pm", "Friday 7pm-9pm"]
    }
  ]
}

BrandProfile:
${JSON.stringify(brandProfile, null, 2)}

Audience Persona Set:
${JSON.stringify(audiencePersonaSet, null, 2)}

Inferred Audience Classification: ${audienceType.toUpperCase()}
(CRITICAL: If B2B: heavily prioritize linkedin as primary platform. If B2C/D2C: heavily prioritize instagram as primary platform.)

PLATFORM SELECTION LOGIC (choose 1–3 from the supported list only):
- B2B / SaaS / Professional services → LinkedIn primary, WhatsApp for direct outreach
- D2C fashion / beauty / lifestyle → Instagram primary, WhatsApp for community
- Educational / thought leadership → LinkedIn primary, Instagram secondary
- Local / community-focused → WhatsApp primary, Instagram secondary
- Any brand → LinkedIn + Instagram is the default combination

POSTING FREQUENCY NORMS:
- LinkedIn: 3–5 posts/week
- Instagram: 5–7 posts/week
- WhatsApp: 2–4 broadcasts/week (status updates or broadcast lists)

BEST POSTING WINDOWS (adjust for geography):
- LinkedIn: Tuesday–Thursday, 8am–10am and 5pm–6pm local time
- Instagram: Monday/Wednesday/Friday, 11am–1pm and 7pm–9pm local time
- WhatsApp: Tuesday/Thursday, 10am–12pm local time`;

  const completion = await callLlm({
    model: process.env.STRATEGY_MODEL || process.env.LLM_MODEL || 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: 'You are a Platform Strategist. Select platform priorities and best posting guidelines based on brand & audience profiles. Return ONLY valid JSON, no markdown.'
      },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.6
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error('Platform Strategy Agent returned empty response');
  
  return JSON.parse(raw);
}

/**
 * Stage 4: Campaign Strategy Agent
 * Decides campaign phases, content distribution mix, and messaging rules.
 */
export async function runCampaignStrategy(
  input: NormalizedInput,
  brandProfile: any,
  audiencePersonaSet: any,
  platformStrategy: any
): Promise<Strategy> {
  logger.info('Running Stage 4: Campaign Strategy Agent...');

  const campaignGoal = input.campaign_goal || 'awareness';

  const prompt = `You are a Campaign Strategist. Your job is to generate a cohesive marketing campaign strategy based on brand intelligence, audience personas, and platform priorities.

Given a BrandProfile, AudiencePersonaSet, and PlatformStrategy JSON, generate a CampaignStrategy.

OUTPUT RULES:
- Output ONLY a valid JSON OBJECT. Not an array. Not prose. Not markdown.
- content_mix percentages MUST sum to exactly 100.
- campaign_goal must be one of: lead_generation, brand_awareness, product_launch, retention, community_growth, sales_conversion.

REQUIRED OUTPUT FORMAT (copy this structure exactly):
{
  "campaign_goal": "brand_awareness",
  "duration_days": 30,
  "campaign_themes": ["founder origin story", "customer transformation", "industry myth-busting"],
  "content_mix": {
    "awareness": 40,
    "consideration": 30,
    "conversion": 15,
    "retention": 10,
    "advocacy": 5
  },
  "messaging_strategy": "Lead with the primary pain point of the target audience. Emphasize the unique differentiator. Include an emotional hook aligned with the brand archetype.",
  "campaign_phases": [
    {
      "dayRange": [1, 7],
      "focus": "awareness",
      "contentMixOverride": { "education": 60, "trust": 35, "promotion": 5 },
      "guidance": "Early phase campaign guidance details"
    }
  ]
}

BrandProfile:
${JSON.stringify(brandProfile, null, 2)}

AudiencePersonas:
${JSON.stringify(audiencePersonaSet, null, 2)}

PlatformStrategy:
${JSON.stringify(platformStrategy, null, 2)}

CONTENT MIX GUIDELINES (percentages must sum to 100):
- Brand awareness campaign: awareness=40, consideration=30, conversion=15, retention=10, advocacy=5
- Lead generation campaign: awareness=25, consideration=35, conversion=30, retention=7, advocacy=3
- Product launch campaign: awareness=30, consideration=25, conversion=35, retention=5, advocacy=5
- Retention campaign: awareness=10, consideration=20, conversion=15, retention=45, advocacy=10
- Community growth campaign: awareness=35, consideration=25, conversion=10, retention=20, advocacy=10

CAMPAIGN DURATION GUIDELINES:
- Brand awareness: 30–60 days
- Lead generation: 30–45 days
- Product launch: 14–30 days
- Retention: 60–90 days
- Community growth: 45–90 days

MESSAGING STRATEGY GUIDELINES:
- Lead with the primary pain point of the highest-priority audience persona.
- Emphasize the brand's unique differentiator (not just features).
- Include an emotional hook aligned with the brand archetype.`;

  const completion = await callLlm({
    model: process.env.STRATEGY_MODEL || process.env.LLM_MODEL || 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: 'You are a Campaign Strategist. Select content mixes and campaign phases. Return ONLY valid JSON, no markdown.'
      },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error('Campaign Strategy Agent returned empty response');

  const parsed = JSON.parse(raw);

  // Map the campaign-strategy-specific content mix (awareness/consideration/conversion) 
  // to the general business content mix (education/trust/promotion) expected by social.aladdyn
  const rawMix = parsed.content_mix || { awareness: 40, consideration: 40, conversion: 20 };
  const mix = {
    education: rawMix.awareness || 40,
    trust: rawMix.consideration || 40,
    promotion: (rawMix.conversion || 20) + (rawMix.retention || 0) + (rawMix.advocacy || 0)
  };

  // Validate content mix totals 100%
  const sum = mix.education + mix.trust + mix.promotion;
  if (Math.abs(sum - 100) > 0.01) {
    logger.warn(`Content mix sum was ${sum} instead of 100. Normalizing.`);
    const factor = 100 / sum;
    mix.education = Math.round(mix.education * factor);
    mix.trust = Math.round(mix.trust * factor);
    mix.promotion = 100 - mix.education - mix.trust;
  }

  // Construct standard output strategy format compatible with social.aladdyn
  const strategyOutput: Strategy = {
    content_pillars: brandProfile.content_pillars,
    tone: brandProfile.tone,
    cta_style: `Brand Archetype: ${brandProfile.brand_archetype} | SOP: ${brandProfile.buyer_sophistication} | Style: ${brandProfile.visual_style}`,
    content_mix: {
      education: mix.education,
      trust: mix.trust,
      promotion: mix.promotion
    },
    campaign_phases: parsed.campaign_phases || [],
  };

  // Pack Target Audience, Pain Points, Personas, Platform Strategy, and Messaging Strategy into the hashtagGroups JSON field as metadata so it is persisted in the DB!
  (strategyOutput as any).hashtagGroups = {
    targetAudience: brandProfile.target_audience,
    painPoints: brandProfile.pain_points,
    personas: audiencePersonaSet.personas,
    platformStrategy: platformStrategy.platforms,
    messagingStrategy: parsed.messaging_strategy
  };

  return strategyOutput;
}
