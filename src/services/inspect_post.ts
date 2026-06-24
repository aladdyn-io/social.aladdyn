/**
 * inspect_post.ts
 *
 * Diagnostic utility to deep-inspect a SocialPost and its parent campaign branding context.
 * Shows exactly what data the image generation pipeline will work with.
 *
 * Usage:
 *   npx tsx src/services/inspect_post.ts <postId>
 */

import prisma from '../lib/prisma';
import { fetchGenieContext } from './genieContext';

const POST_ID = process.argv[2];

async function main() {
  if (!POST_ID) {
    console.error('❌ Usage: npx tsx src/services/inspect_post.ts <postId>');
    process.exit(1);
  }

  console.log(`\n🔍 Inspecting post: ${POST_ID}\n`);
  console.log('═'.repeat(70));

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
        },
      },
    },
  });

  if (!post) {
    console.error(`❌ Post not found: ${POST_ID}`);
    process.exit(1);
  }

  // 2. Post details
  console.log('\n📄 POST DETAILS');
  console.log('─'.repeat(50));
  console.log(`  ID:            ${post.id}`);
  console.log(`  Status:        ${post.status}`);
  console.log(`  Platform:      ${post.platform}`);
  console.log(`  ContentType:   ${post.contentType}`);
  console.log(`  Topic:         ${post.topic ?? '(none)'}`);
  console.log(`  ContentPillar: ${post.contentPillar ?? '(none)'}`);
  console.log(`  ScheduledDate: ${post.scheduledDate.toISOString().split('T')[0]}`);
  console.log(`  ImageUrl:      ${post.imageUrl ?? '(not generated yet)'}`);
  console.log(`  ImageGenerated:${post.imageGenerated}`);
  console.log();
  console.log(`  Caption:       ${post.caption ? post.caption.substring(0, 120) + '...' : '(none)'}`);
  console.log();
  console.log(`  ImagePrompt:   ${post.imagePrompt ? post.imagePrompt.substring(0, 200) + '...' : '(none)'}`);

  // 3. Campaign branding
  const campaign = post.campaign;
  console.log('\n\n🏢 CAMPAIGN BRANDING CONTEXT');
  console.log('─'.repeat(50));
  console.log(`  Campaign ID:   ${campaign.id}`);
  console.log(`  Campaign Name: ${campaign.name ?? '(none)'}`);
  console.log(`  Company Name:  ${campaign.companyName ?? '(none)'}`);
  console.log(`  Brand Logo:    ${campaign.brandLogo ?? '⚠️  MISSING'}`);
  console.log(`  Brand Color:   ${campaign.brandColor ?? '⚠️  MISSING'}`);
  console.log(`  Accent Color:  ${campaign.accentColor ?? '⚠️  MISSING'}`);
  console.log(`  Industry:      ${campaign.industry ?? '(none)'}`);
  console.log(`  Geography:     ${campaign.geography ?? '(none)'}`);
  console.log(`  Tone:          ${campaign.tone ?? '(none)'}`);
  console.log(`  Funnel ID:     ${campaign.funnelId}`);
  console.log(`  Services:      ${campaign.services.length > 0 ? campaign.services.join(', ') : '(none)'}`);

  // 4. Genie fallback context
  console.log('\n\n🌐 GENIE FALLBACK CONTEXT');
  console.log('─'.repeat(50));
  if (campaign.funnelId && campaign.funnelId !== 'direct') {
    const genieCtx = await fetchGenieContext(campaign.funnelId);
    if (genieCtx) {
      console.log(`  Company Name:  ${genieCtx.companyName ?? '(none)'}`);
      console.log(`  Brand Logo:    ${genieCtx.brandLogo ?? '(none)'}`);
      console.log(`  Brand Color:   ${genieCtx.brandColor ?? '(none)'}`);
      console.log(`  Accent Color:  ${genieCtx.brandAccentColor ?? '(none)'}`);
      console.log(`  Tone:          ${genieCtx.tone ?? '(none)'}`);
    } else {
      console.log('  ⚠️  Genie returned no context for this funnel.');
    }
  } else {
    console.log('  ℹ️  Campaign was created directly (no funnel). Skipping Genie lookup.');
  }

  // 5. What the pipeline will actually use
  const brandLogoUrl = campaign.brandLogo || '(WILL FALL BACK TO GENIE or placeholder)';
  const brandName = campaign.companyName || campaign.name || '(WILL FALL BACK TO GENIE or default)';
  const brandColor = campaign.brandColor || '(WILL FALL BACK TO GENIE or #764ba2)';
  const accentColor = campaign.accentColor || '(WILL FALL BACK TO GENIE or #667eea)';

  console.log('\n\n✅ EFFECTIVE PIPELINE VALUES');
  console.log('─'.repeat(50));
  console.log(`  Logo URL:     ${brandLogoUrl}`);
  console.log(`  Brand Name:   ${brandName}`);
  console.log(`  Brand Color:  ${brandColor}`);
  console.log(`  Accent Color: ${accentColor}`);

  console.log('\n' + '═'.repeat(70) + '\n');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  prisma.$disconnect();
  process.exit(1);
});
