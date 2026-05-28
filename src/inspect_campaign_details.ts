import prisma from './lib/prisma';

async function main() {
  console.log('--- CAMPAIGNS ---');
  const campaigns = await prisma.socialCampaign.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3
  });
  campaigns.forEach(c => {
    console.log(`Campaign ID: ${c.id}`);
    console.log(`Name: ${c.name}`);
    console.log(`Status: ${c.status}`);
    console.log(`Brand Color: ${c.brandColor}`);
    console.log(`Accent Color: ${c.accentColor}`);
    console.log(`Created: ${c.createdAt}`);
    console.log('---------------------------');
  });

  if (campaigns.length > 0) {
    const latestId = campaigns[0].id;
    console.log(`\n--- POSTS FOR LATEST CAMPAIGN (${latestId}) ---`);
    const posts = await prisma.socialPost.findMany({
      where: { campaignId: latestId },
      orderBy: { scheduledDate: 'asc' }
    });
    posts.forEach(p => {
      console.log(`Post ID: ${p.id}`);
      console.log(`ContentType: ${p.contentType}`);
      console.log(`Topic: ${p.topic}`);
      console.log(`ImageUrl: ${p.imageUrl}`);
      console.log(`ImageGenerated: ${p.imageGenerated}`);
      console.log('---------------------------');
    });
  }
}

main().catch(console.error);
