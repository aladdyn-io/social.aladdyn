import dotenv from 'dotenv';
import path from 'path';

// Load environmental variables from the project root .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { generateLayoutBlueprint } from './layoutDirector';
import { generateAdCopyBlueprint } from './copyDirector';
import { analyzeLocalColors } from './colorAnalyzer';

async function runTests() {
  console.log('🧪 DIAGNOSTIC TEST: EID MUBARAK POST COLOR AND LAYOUT CONTRAST INSPECTION\n');

  const tc = {
    name: '🌙 FESTIVE CELEBRATION POST (EID MUBARAK)',
    industry: 'D2C Skincare',
    services: ['Hyaluronic Acid Serum', 'Anti-Aging Cream', 'Hydrating Face Mist'],
    brandColor: '#0f172a',
    topic: 'Eid Mubarak: 15% Off Hydrating Face Mist this Bakrid',
    caption: "As we celebrate the spirit of Bakrid, we wish you and your loved ones peace and prosperity. This festive season, take a moment to rejuvenate your skin with our hydrating face mist and hyaluronic acid serum. Visit our website to explore.",
    imagePrompt: 'Generate a serene, high-end bathroom setup with a modern minimalist aesthetic...',
    safestQuadrant: 'top_left' as const,
    isDarkBg: true // bathroom wall is dark grey/blue (#0f172a)
  };

  try {
    // 1. Sample preliminary colors
    const colorMetrics = await analyzeLocalColors(
      Buffer.alloc(0), // mock
      tc.safestQuadrant,
      8
    ).catch(() => ({
      headlineColor: '#FFFFFF',
      subtitleColor: '#E2E8F0',
      isDarkBg: true,
      bgOpacityOverride: 0.5
    }));

    console.log(`📌 Preliminary colorMetrics: isDarkBg=\${colorMetrics.isDarkBg}, headlineColor=\${colorMetrics.headlineColor}`);

    // 1.5 Call Copy Director
    const copyBlueprint = await generateAdCopyBlueprint({
      topic: tc.topic,
      caption: tc.caption,
      industry: tc.industry,
      brandName: 'Aladdyn Beauty'
    });

    // 2. Call Layout Director
    const blueprint = await generateLayoutBlueprint({
      imagePrompt: tc.imagePrompt,
      industry: tc.industry,
      services: tc.services,
      baseColor: tc.brandColor,
      safestQuadrant: tc.safestQuadrant,
      contrastMetrics: {
        isDarkBg: colorMetrics.isDarkBg,
        headlineColor: colorMetrics.headlineColor,
        subtitleColor: colorMetrics.subtitleColor,
        averageColorHex: (colorMetrics as any).averageColorHex || '#121212',
        averageColorName: (colorMetrics as any).averageColorName || 'Dark Slate Grey'
      },
      feedback: "Please make sure to use script cursive highlights (wrap key word in span font-script) for the primary emotional keywords, solid checklist badges, and circular arrow CTA pill shape!",
      copyBlueprint
    });

    console.log(`\n📌 Layout Blueprint Metadata:`);
    console.log(JSON.stringify(blueprint, null, 2));

    if (blueprint.dynamicHtmlBlock) {
      console.log(`\n💎 CUSTOM HTML BLOCK GENERATED:`);
      console.log(`-----------------------------------------`);
      console.log(blueprint.dynamicHtmlBlock);
      console.log(`-----------------------------------------`);
      
      const hasDoubleQuotesInBlock = blueprint.dynamicHtmlBlock.includes('"');
      console.log(`\n🔍 JSON-Safe Verification Check:`);
      console.log(`   - Uses Single-Quotes for attributes? \${hasDoubleQuotesInBlock ? '❌ FAIL (found double quotes in HTML)' : '✅ PASS'}`);
      
      const containsDarkColor = blueprint.dynamicHtmlBlock.includes('color: #111111') || blueprint.dynamicHtmlBlock.includes('text-slate-900') || blueprint.dynamicHtmlBlock.includes('color: #0f172a');
      const containsLightColor = blueprint.dynamicHtmlBlock.includes('color: #FFFFFF') || blueprint.dynamicHtmlBlock.includes('color: #ffffff') || blueprint.dynamicHtmlBlock.includes('text-white') || blueprint.dynamicHtmlBlock.includes('text-slate-100');
      
      console.log(`\n🔍 Typography Contrast Color Verification Check:`);
      console.log(`   - Background is Dark?               \${colorMetrics.isDarkBg}`);
      console.log(`   - Contains light text colors?       \${containsLightColor ? '✅ PASS' : '❌ FAIL (no light text colors found!)'}`);
      console.log(`   - Contains dark text colors?        \${containsDarkColor ? '⚠️ WARNING (found dark text color on dark background!)' : '✅ PASS'}`);
    } else {
      console.log(`\n⚠️ No dynamicHtmlBlock was generated.`);
    }
    
  } catch (err: any) {
    console.error(`❌ Layout generation failed: \${err.message}`);
  }
}

runTests();
