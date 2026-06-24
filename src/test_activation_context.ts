/**
 * test_activation_context.ts
 *
 * Quick diagnostic script to inspect the activation context (brand logo, colors, name)
 * that will be resolved for a given funnel ID.
 *
 * Usage:
 *   npx tsx src/test_activation_context.ts [funnelId]
 *
 * If no funnelId is provided, it will list recent campaigns with their funnelIds.
 */

import prisma from './lib/prisma';
import { fetchGenieContext } from './services/genieContext';

const FUNNEL_ID = process.argv[2];

async function main() {
  if (FUNNEL_ID) {
    console.log(`\n🔍 Fetching activation context for funnel: ${FUNNEL_ID}\n`);
    console.log('─'.repeat(60));

    // 1. Check local campaign DB for this funnel
    const campaigns = await prisma.socialCampaign.findMany({
      where: { funnelId: FUNNEL_ID },
      select: {
        id: true,
        name: true,
        companyName: true,
        brandLogo: true,
        brandColor: true,
        accentColor: true,
        industry: true,
        geography: true,
        funnelId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    if (campaigns.length > 0) {
      console.log(`📋 Found ${campaigns.length} campaign(s) in DB for this funnel:\n`);
      campaigns.forEach((c, i) => {
        console.log(`  Campaign ${i + 1}: ${c.id}`);
        console.log(`    Name:         ${c.name ?? '(none)'}`);
        console.log(`    Company:      ${c.companyName ?? '(none)'}`);
        console.log(`    Logo:         ${c.brandLogo ?? '(none)'}`);
        console.log(`    Brand Color:  ${c.brandColor ?? '(none)'}`);
        console.log(`    Accent Color: ${c.accentColor ?? '(none)'}`);
        console.log(`    Industry:     ${c.industry ?? '(none)'}`);
        console.log();
      });
    } else {
      console.log('  ℹ️  No campaigns found in DB for this funnel.\n');
    }

    // 2. Fetch live genie context
    console.log('🌐 Fetching live Genie context...\n');
    const genieCtx = await fetchGenieContext(FUNNEL_ID);

    if (genieCtx) {
      console.log('  ✅ Genie context resolved:');
      console.log(`    Company Name:    ${genieCtx.companyName ?? '(none)'}`);
      console.log(`    Industry:        ${genieCtx.industry ?? '(none)'}`);
      console.log(`    Geography:       ${genieCtx.geography ?? '(none)'}`);
      console.log(`    Tone:            ${genieCtx.tone ?? '(none)'}`);
      console.log(`    Website:         ${genieCtx.websiteUrl ?? '(none)'}`);
      console.log(`    Brand Logo:      ${genieCtx.brandLogo ?? '(none)'}`);
      console.log(`    Brand Color:     ${genieCtx.brandColor ?? '(none)'}`);
      console.log(`    Accent Color:    ${genieCtx.brandAccentColor ?? '(none)'}`);
    } else {
      console.log('  ⚠️  No Genie context returned (funnel may not be scraped yet).\n');
    }

    // 3. Show what will actually be resolved by the pipeline (mirrors onDemandImageGeneration logic)
    const firstCampaign = campaigns[0];
    console.log('\n' + '─'.repeat(60));
    console.log('🎨 Effective resolved brand values (what the pipeline will use):\n');

    // Mirrors the exact logic in generatePostImage()
    let effectiveLogo  = firstCampaign?.brandLogo  || '';
    let effectiveName  = firstCampaign?.companyName || '';
    let effectiveColor = firstCampaign?.brandColor  || '#764ba2';
    let effectiveAccent = firstCampaign?.accentColor || '#667eea';

    if (genieCtx) {
      if (!effectiveLogo  && genieCtx.brandLogo)                                         effectiveLogo  = genieCtx.brandLogo;
      if (!effectiveName  && genieCtx.companyName)                                        effectiveName  = genieCtx.companyName;
      if (effectiveColor  === '#764ba2' && genieCtx.brandColor)                           effectiveColor = genieCtx.brandColor;
      if (effectiveAccent === '#667eea' && genieCtx.brandAccentColor)                     effectiveAccent = genieCtx.brandAccentColor;
    }
    if (!effectiveName) effectiveName = firstCampaign?.name || '(no name)';

    console.log(`  Logo URL:     ${effectiveLogo  || '(no logo)'}`);
    console.log(`  Brand Name:   ${effectiveName}`);
    console.log(`  Brand Color:  ${effectiveColor}`);
    console.log(`  Accent Color: ${effectiveAccent}`);
    console.log();

  } else {
    // List recent campaigns with their funnelIds
    console.log('\n📋 Recent campaigns (to find funnelId):\n');
    const campaigns = await prisma.socialCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        name: true,
        funnelId: true,
        companyName: true,
        brandLogo: true,
        brandColor: true,
        accentColor: true,
        createdAt: true,
      },
    });

    campaigns.forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.id}`);
      console.log(`     Name:        ${c.name ?? '(none)'}`);
      console.log(`     Funnel ID:   ${c.funnelId}`);
      console.log(`     Company:     ${c.companyName ?? '(none)'}`);
      console.log(`     Logo:        ${c.brandLogo ? '✅ set' : '❌ missing'}`);
      console.log(`     BrandColor:  ${c.brandColor ?? '(none)'}`);
      console.log(`     AccentColor: ${c.accentColor ?? '(none)'}`);
      console.log();
    });

    console.log('💡 Usage: npx tsx src/test_activation_context.ts <funnelId>');
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  prisma.$disconnect();
  process.exit(1);
});
