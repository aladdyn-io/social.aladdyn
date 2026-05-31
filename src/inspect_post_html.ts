import prisma from './lib/prisma';
import { generateLayoutBlueprint } from './services/layoutDirector';
import { generateAdCopyBlueprint } from './services/copyDirector';
import { analyzeLocalColors } from './services/colorAnalyzer';
import { analyzeImageSaliency } from './services/saliencyAnalyzer';
import axios from 'axios';

const POST_ID = 'de94df0e-5ede-45a2-a430-ea65d2669a6a';

async function main() {
  console.log(`🔍 Inspecting Post ID: ${POST_ID}`);
  
  const post = await prisma.socialPost.findUniqueOrThrow({
    where: { id: POST_ID },
    include: { campaign: true }
  });

  console.log(`Campaign Name: ${post.campaign.name}`);
  console.log(`Campaign Brand Color: ${post.campaign.brandColor}`);
  console.log(`Campaign Accent Color: ${post.campaign.accentColor}`);
  console.log(`Topic: ${post.topic}`);
  console.log(`Caption: ${post.caption}`);

  // Fetch base image buffer from the uploaded imageUrl (MinIO)
  if (!post.imageUrl) {
    console.error('Post does not have imageUrl');
    return;
  }

  // Get primary URL if comma-separated
  const urlToFetch = post.imageUrl.includes(',') ? post.imageUrl.split(',')[0] : post.imageUrl;
  console.log(`Downloading base image from: ${urlToFetch}`);
  
  const response = await axios.get(urlToFetch, { responseType: 'arraybuffer' });
  const imageBuffer = Buffer.from(response.data);

  // Saliency & colors
  const baseSaliency = await analyzeImageSaliency(imageBuffer);
  const safestQuadrant = baseSaliency.safestQuadrant;
  const colorMetrics = await analyzeLocalColors(imageBuffer, safestQuadrant, 8);

  const accentColor = post.campaign.accentColor || post.campaign.brandColor || '#8B5CF6';
  console.log(`\nComputed accentColor in script: ${accentColor}`);

  const copyBlueprint = await generateAdCopyBlueprint({
    topic: post.topic || '',
    caption: post.caption || '',
    brandName: 'Aladdyn CRM',
    industry: post.campaign.industry || 'Lifestyle',
  });

  // Run Layout Director
  const blueprint = await generateLayoutBlueprint({
    imagePrompt: post.imagePrompt || 'office automation setup',
    industry: post.campaign.industry || 'Lifestyle',
    services: post.campaign.services || [],
    baseColor: post.campaign.brandColor || '#000000',
    accentColor: post.campaign.accentColor || undefined,
    geography: post.campaign.geography || undefined,
    safestQuadrant,
    contrastMetrics: {
      isDarkBg: colorMetrics.isDarkBg,
      headlineColor: colorMetrics.headlineColor,
      subtitleColor: colorMetrics.subtitleColor
    },
    copyBlueprint
  });

  console.log(`\n--- LAYOUT BLUEPRINT ---`);
  console.log(`designArchetype: ${blueprint.designArchetype}`);
  console.log(`layoutType: ${blueprint.layoutType}`);
  console.log(`typographyZIndex: ${blueprint.typographyZIndex}`);
  console.log(`requireGlassmorphism: ${blueprint.requireGlassmorphism}`);
  console.log(`accentColor in blueprint: ${blueprint.textColorOverride}`);
  
  if (blueprint.dynamicHtmlBlock) {
    console.log(`\n💎 DYNAMIC HTML BLOCK:`);
    console.log('--------------------------------------------------');
    console.log(blueprint.dynamicHtmlBlock);
    console.log('--------------------------------------------------');
  } else {
    console.log('No dynamicHtmlBlock was generated.');
  }
}

main().catch(console.error);
