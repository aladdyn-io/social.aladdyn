import prisma from './lib/prisma';
import { generateDetailedVideoPrompt } from './services/generateVideoPrompt';

async function main() {
  // Grab topic from command line arguments or use a default
  const topicArg = process.argv.slice(2).join(' ');
  const topic = topicArg || 'Unlock your natural glow: Skincare Routine';
  console.log(`🎬 Generating Video Prompt for topic: "${topic}"...`);

  // Fetch campaign to get brand colors and industry context
  const campaign = await prisma.socialCampaign.findFirst({
    orderBy: { createdAt: 'desc' }
  });

  if (!campaign) {
    console.error("❌ No campaign found in database. Please run a campaign first or seed the database.");
    return;
  }

  console.log(`📦 Loaded campaign context: ${campaign.companyName || campaign.name} (${campaign.industry})`);

  // Mock a CalendarItem
  const mockItem = {
    date: new Date().toISOString(),
    topic: topic,
    pillar: 'Product Staging',
    platform: 'Instagram',
    content_type: 'Reel',
    is_festival: false
  };

  const mockStrategy = {
    id: 'mock-strategy',
    campaignId: campaign.id,
    contentPillars: ['Education', 'Product'],
    tone: campaign.tone || 'Aspirational and Professional',
    ctaStyle: 'standard',
    contentMix: [],
    campaignPhases: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const normalizedInput = {
    industry: campaign.industry || 'Skincare',
    geography: campaign.geography || 'India',
    services: campaign.services || ['skincare', 'face wash'],
    base_color: campaign.brandColor || '#0f172a',
    accent_color: campaign.accentColor || '#8b5cf6',
    font_style: 'Plus Jakarta Sans',
    platform: 'Instagram'
  };

  try {
    const videoPrompt = await generateDetailedVideoPrompt(
      mockItem as any,
      mockStrategy as any,
      normalizedInput as any
    );

    console.log("\n==========================================================================================");
    console.log("🎥 GENERATED MOTION-AWARE VIDEO PROMPT (OPTIMIZED FOR KLING / RUNWAY):");
    console.log("==========================================================================================");
    console.log(videoPrompt);
    console.log("==========================================================================================\n");
  } catch (err: any) {
    console.error("❌ Failed to generate video prompt:", err.message);
  }
}

main()
  .catch(err => console.error(err))
  .finally(() => prisma.$disconnect());
