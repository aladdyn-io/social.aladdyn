import prisma from './lib/prisma';

async function main() {
  console.log('=== INSPECTING ACTIVE ARCHETYPE ===');
  const latestCampaign = await prisma.socialCampaign.findFirst({
    orderBy: { createdAt: 'desc' },
    include: { strategy: true, posts: true }
  });

  if (!latestCampaign) {
    console.log('No campaigns found in the database.');
    return;
  }

  console.log(`Latest Campaign: ${latestCampaign.name}`);
  console.log(`Campaign ID: ${latestCampaign.id}`);
  console.log(`Industry: ${latestCampaign.industry}`);
  console.log(`Company Description: ${latestCampaign.companyDesc}`);
  console.log(`Tone: ${latestCampaign.tone}`);
  console.log(`Brand Color: ${latestCampaign.brandColor}`);
  console.log(`Accent Color: ${latestCampaign.accentColor}`);
  console.log(`Services: ${latestCampaign.services.join(', ')}`);
  
  if (latestCampaign.strategy) {
    console.log('\n=== STRATEGY DETAILS ===');
    console.log(`Pillars: ${latestCampaign.strategy.contentPillars.join(', ')}`);
    console.log(`CTA Style Field: ${latestCampaign.strategy.ctaStyle}`);
    console.log(`Hashtag Groups Field:`, JSON.stringify(latestCampaign.strategy.hashtagGroups, null, 2));
  } else {
    console.log('\nNo strategy generated for this campaign yet.');
  }

  const postsWithImages = latestCampaign.posts.filter(p => p.imageUrl);
  console.log(`\n=== POST DETAILS ===`);
  console.log(`Total Posts: ${latestCampaign.posts.length}`);
  console.log(`Posts with Generated Images: ${postsWithImages.length}`);

  for (const post of latestCampaign.posts) {
    if (post.imageUrl) {
      console.log(`\n- Post ID: ${post.id}`);
      console.log(`  Topic: ${post.topic}`);
      console.log(`  ContentType: ${post.contentType}`);
      console.log(`  Image Url: ${post.imageUrl}`);
      console.log(`  Image Model: ${post.imageModel}`);
      console.log(`  Image Prompt: ${post.imagePrompt?.substring(0, 100)}...`);
      
      // Let's check if there is a layout blueprint stored in the DB for this post
      // In prisma/schema.prisma, is there a layout blueprint field? Let's check.
    }
  }
}

main().catch(console.error);
