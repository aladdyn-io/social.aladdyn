import prisma from './lib/prisma';

async function main() {
  const campaignId = '3d4ac55a-2d66-4110-a0a7-1e4c37804773';
  const c = await prisma.socialCampaign.findUnique({
    where: { id: campaignId }
  });
  console.log(`Campaign funnelId: "${c?.funnelId}"`);
  console.log(`Campaign brandLogo: "${c?.brandLogo}"`);
  console.log(`Campaign companyName: "${c?.companyName}"`);
  console.log(`Campaign brandColor: "${c?.brandColor}"`);
  console.log(`Campaign accentColor: "${c?.accentColor}"`);
}

main().catch(console.error);
