/**
 * test-video-prompts.ts
 *
 * Quick test to see what video prompts get generated for different
 * reel/story scenarios. No Kling key needed — just uses Groq LLM.
 *
 * Run with:
 *   npx tsx test-video-prompts.ts
 */

import 'dotenv/config';
import { generateDetailedVideoPrompt } from './src/services/generateVideoPrompt';
import { deriveVideoConfig, isVideoContentType } from './src/services/onDemandVideoGeneration';

// ── Sample scenarios ──────────────────────────────────────────────────────────

const scenarios = [
  {
    label: 'Instagram Reel — D2C Skincare',
    calendarItem: {
      date: '2025-02-01',
      pillar: 'Product Education',
      topic: 'How our vitamin C serum transforms dull skin in 7 days',
      content_type: 'reel',
      is_festival: false,
      platform: 'instagram',
    },
    strategy: {
      tone: 'warm, aspirational, and science-backed',
      content_pillars: ['Product Education', 'Customer Results', 'Brand Story'],
      content_mix: { education: 40, trust: 40, promotion: 20 },
    },
    normalized: {
      industry: 'D2C Skincare',
      services: ['Vitamin C Serum', 'Moisturizer', 'SPF Sunscreen'],
      geography: 'India',
      base_color: '#F5E6D3',
      accent_color: '#E8A87C',
      platform: 'instagram',
    },
  },
  {
    label: 'Instagram Story — Festive (Diwali)',
    calendarItem: {
      date: '2025-10-20',
      pillar: 'Festival / Brand Connect',
      topic: 'Diwali celebration with our brand',
      content_type: 'story',
      is_festival: true,
      festival_name: 'Diwali',
      platform: 'instagram',
    },
    strategy: {
      tone: 'celebratory, warm, and community-focused',
      content_pillars: ['Festival Connect', 'Brand Values'],
      content_mix: { education: 20, trust: 50, promotion: 30 },
    },
    normalized: {
      industry: 'D2C Lifestyle Brand',
      services: ['Home Decor', 'Gift Sets', 'Candles'],
      geography: 'India',
      base_color: '#8B1A1A',
      accent_color: '#FFD700',
      platform: 'instagram',
    },
  },
  {
    label: 'LinkedIn Reel — B2B SaaS',
    calendarItem: {
      date: '2025-02-05',
      pillar: 'ROI and Efficiency',
      topic: 'How our platform cuts invoice processing time by 80%',
      content_type: 'reel',
      is_festival: false,
      platform: 'linkedin',
    },
    strategy: {
      tone: 'authoritative, data-driven, and pragmatic',
      content_pillars: ['ROI Proof', 'Customer Success', 'Product Demo'],
      content_mix: { education: 50, trust: 35, promotion: 15 },
    },
    normalized: {
      industry: 'B2B SaaS — Finance Automation',
      services: ['Invoice Processing', 'AP Automation', 'Cash Flow Analytics'],
      geography: 'USA',
      base_color: '#0F172A',
      accent_color: '#3B82F6',
      platform: 'linkedin',
    },
  },
];

// ── Run ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(70));
  console.log('VIDEO PROMPT GENERATION TEST');
  console.log('='.repeat(70));

  // First show routing + config logic (no LLM needed)
  console.log('\n── Content Type Routing ──');
  for (const type of ['reel', 'story', 'photo', 'carousel', 'written', 'unknown']) {
    console.log(`  isVideoContentType('${type}') = ${isVideoContentType(type)}`);
  }

  console.log('\n── Platform Video Configs ──');
  const platforms = ['instagram', 'linkedin', 'whatsapp', 'tiktok'];
  const types = ['reel', 'story'];
  for (const p of platforms) {
    for (const t of types) {
      const config = deriveVideoConfig(p, t);
      console.log(`  ${p}/${t}: ${config.aspectRatio}, ${config.duration}s, ${config.modelName}`);
    }
  }

  // Now generate actual prompts via LLM
  console.log('\n── Generated Video Prompts ──\n');

  for (const scenario of scenarios) {
    console.log(`▶ ${scenario.label}`);
    console.log(`  Topic: ${scenario.calendarItem.topic}`);
    console.log(`  Platform: ${scenario.calendarItem.platform} / ${scenario.calendarItem.content_type}`);
    console.log(`  Config: ${JSON.stringify(deriveVideoConfig(scenario.calendarItem.platform!, scenario.calendarItem.content_type))}`);
    console.log('');

    try {
      const prompt = await generateDetailedVideoPrompt(
        scenario.calendarItem as any,
        scenario.strategy as any,
        scenario.normalized as any
      );
      console.log('  PROMPT:');
      // Word-wrap at 70 chars for readability
      const words = prompt.split(' ');
      let line = '  ';
      for (const word of words) {
        if (line.length + word.length > 72) {
          console.log(line);
          line = '  ' + word + ' ';
        } else {
          line += word + ' ';
        }
      }
      if (line.trim()) console.log(line);
      console.log(`\n  Length: ${prompt.length} chars`);
    } catch (err: any) {
      console.log(`  ERROR: ${err.message}`);
    }

    console.log('\n' + '-'.repeat(70) + '\n');
  }
}

main().catch(console.error);
