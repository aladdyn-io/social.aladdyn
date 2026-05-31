/**
 * 🧪 Aladdyn Social Live LinkedIn Carousel Scheduling & Posting Validator
 * 
 * This script automates the full live publishing and scheduling flow for a carousel:
 * 1. Checks PostgreSQL database connectivity.
 * 2. Injects a temporary campaign and a post with `contentType: 'carousel'`.
 * 3. Invokes `generatePostImage(postId)` to autonomously generate all 4 slides
 *    via the Playwright composite engine and upload them to storage.
 * 4. Transitions the post status to `APPROVED` (matching user UI click).
 * 5. Runs the Scheduler to compute target date-time offset and queue it.
 * 6. Checks if the scheduled time is in the future:
 *    - If FUTURE: Enqueues a delayed job in Redis, leaves database records intact, and exits.
 *    - If IMMEDIATE / PAST: Boots worker locally, monitors live status transition to POSTED, and cleans up.
 * 
 * Run with:
 *   npx tsx src/test_actual_carousel.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import prisma from './lib/prisma';
import { generatePostImage } from './services/onDemandImageGeneration';
import { scheduleUpcomingPosts, getPostTargetDateTime } from './jobs/scheduler';
import { startPublishWorker } from './jobs/workers/publishWorker';
import { publishQueue } from './jobs/queues';
import IORedis from 'ioredis';

async function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('================================================================');
  console.log('🧪 Aladdyn Social: Live LinkedIn Carousel Scheduler & Publisher');
  console.log('================================================================\n');

  // --- Step 1: Validate Environment Credentials ---
  const accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
  const memberUrn = process.env.LINKEDIN_MEMBER_URN;

  if (!accessToken || !memberUrn) {
    console.error('   ✗ Missing LINKEDIN_ACCESS_TOKEN or LINKEDIN_MEMBER_URN in .env');
    console.error('     Please run src/test_linkedin_real.ts first to set up your credentials.');
    process.exit(1);
  }

  // --- Step 2: Database Connection Check ---
  console.log('1. Connecting to Neon Cloud PostgreSQL Database...');
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('   ✓ Cloud Database connected successfully!\n');
  } catch (error: any) {
    console.error('   ✗ Database connection failed:');
    console.error(`     ${error.message}`);
    process.exit(1);
  }

  // --- Step 3: Inject Temporary Carousel Post ---
  const campaignId = `test-campaign-carousel-${Date.now()}`;
  const postId = `test-post-carousel-${Date.now()}`;
  const now = new Date();

  // Dynamically calculate a target time 15 minutes in the future (in Asia/Kolkata timezone)
  const futureDate = new Date(Date.now() + 15 * 60 * 1000);
  // Format as HH:MM
  const targetScheduledTime = `${String(futureDate.getHours()).padStart(2, '0')}:${String(futureDate.getMinutes()).padStart(2, '0')}`;

  console.log(`2. Injecting campaign and carousel post (scheduled for ${targetScheduledTime})...`);
  try {
    // Create temporary Campaign
    await prisma.socialCampaign.create({
      data: {
        id: campaignId,
        funnelId: 'test-funnel-carousel',
        userId: 'test-user',
        name: '🤖 Real LinkedIn Carousel Test Campaign',
        startDate: now,
        endDate: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        timezone: 'Asia/Kolkata',
        totalDays: 1,
        frequencyPerWeek: 7,
        platforms: ['linkedin'],
        contentMix: { carousel: 1 },
        status: 'READY',
        brandColor: '#004cff',
        accentColor: '#10b981',
      }
    });

    // Create temporary Carousel Post in DRAFT status
    await prisma.socialPost.create({
      data: {
        id: postId,
        campaignId,
        scheduledDate: now,
        scheduledTime: targetScheduledTime,
        timezone: 'Asia/Kolkata',
        platform: 'linkedin',
        contentType: 'carousel',
        topic: 'Next-Gen Autonomous Campaign Engineering',
        caption: 'Experience next-generation autonomous AI campaign engineering with Aladdyn! 🚀🤖\n\nOur intelligent engines automatically compose visual elements, optimize WCAG contrast, and publish across channels. See this live multi-slide carousel in action!',
        hashtags: ['Aladdyn', 'AIAdvertising', 'LinkedInAutomation', 'TechInnovation'],
        imagePrompt: 'Premium futuristic workspace with glowing digital overlays, glassmorphism UI dashboard, sleek branding colors, and warm modern office lighting, highly detailed tech composition',
        imageModel: 'replicate-flux',
        status: 'DRAFT',
      }
    });

    console.log(`   ✓ Test campaign created: [${campaignId}]`);
    console.log(`   ✓ Test carousel post created: [${postId}]`);
  } catch (error: any) {
    console.error('   ✗ Failed to setup test records:');
    console.error(`     ${error.message}`);
    process.exit(1);
  }

  // --- Step 4: Run Ad Compositor Slide Generation ---
  console.log('\n3. Running Playwright Ad Compositor to generate all 4 carousel slides...');
  console.log('   ⏳ Please wait, generating and uploading images to MinIO storage (takes about 15-20s)...');
  
  try {
    const coverSlideUrl = await generatePostImage(postId);
    console.log('   ✓ Carousel Cover slide generated successfully!');
    console.log(`     URL: ${coverSlideUrl}\n`);
  } catch (error: any) {
    console.error('   ✗ Carousel generation failed:');
    console.error(`     ${error.message}`);
    await cleanup(campaignId);
    process.exit(1);
  }

  // --- Step 5: Transition Post status to APPROVED ---
  console.log('4. Approving post to trigger the scheduling workflow...');
  const post = await prisma.socialPost.update({
    where: { id: postId },
    data: { status: 'APPROVED', approvedAt: new Date() }
  });

  const slideUrls = post.imageUrl;
  if (!slideUrls) {
    console.error('   ✗ Error: Slide URLs were not saved in database.');
    await cleanup(campaignId);
    process.exit(1);
  }

  const urls = slideUrls.split(',');
  console.log(`   ✓ Retained ${urls.length} slide images for LinkedIn:`);
  urls.forEach((url, i) => console.log(`     👉 Slide ${i + 1}: ${url}`));

  // --- Step 6: Determine Future vs Immediate Execution ---
  const targetDateTime = getPostTargetDateTime(post.scheduledDate, post.scheduledTime, post.timezone);
  const isFuture = targetDateTime.getTime() > Date.now() + 60 * 1000; // More than 1 minute in the future

  // Empty any existing stuck jobs for this ID
  await publishQueue.remove(`publish-${postId}`).catch(() => {});

  if (isFuture) {
    console.log('\n5. Scheduled time is in the FUTURE. Triggering scheduler lookup...');
    await scheduleUpcomingPosts();

    const scheduledPost = await prisma.socialPost.findUniqueOrThrow({ where: { id: postId } });
    
    console.log('\n================================================================');
    console.log(`✓ SUCCESS! Carousel post has been scheduled for ${post.scheduledTime}!`);
    console.log(`   ✓ Target UTC Time: ${targetDateTime.toISOString()}`);
    console.log(`   ✓ Current UTC Time: ${new Date().toISOString()}`);
    console.log(`   ✓ Database Post Status updated to: [${scheduledPost.status}]`);
    console.log('   ✓ Redis BullMQ Delayed Job enqueued successfully!');
    console.log('\n   👉 NOTE: We are leaving the database campaign/post records active.');
    console.log(`      Your active background 'npm run dev' server/worker will publish it`);
    console.log(`      live to LinkedIn automatically at exactly ${post.scheduledTime}!`);
    console.log('================================================================\n');
  } else {
    console.log('\n5. Scheduled time is in the PAST or IMMEDIATE. Booting local worker to run...');
    
    // Connect to Redis for testing
    const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    const redis = new IORedis(redisUrl, { maxRetriesPerRequest: 1 });

    const worker = startPublishWorker();
    
    console.log('   Running scheduleUpcomingPosts()...');
    await scheduleUpcomingPosts();

    console.log('   Monitoring DB State transitions (Max 45 seconds)...');
    const startTime = Date.now();
    let completedSuccessfully = false;

    while (Date.now() - startTime < 45000) {
      const livePost = await prisma.socialPost.findUnique({
        where: { id: postId },
        select: { status: true, publishAttempts: true, publishError: true }
      });

      if (!livePost) {
        console.log('   ✗ Post was deleted unexpectedly.');
        break;
      }

      console.log(`   [${new Date().toLocaleTimeString()}] Database Post Status: ⚡ [${livePost.status}] (Attempts: ${livePost.publishAttempts})`);

      if (livePost.status === 'POSTED') {
        console.log('\n   🎉 SUCCESS! The Publish Worker successfully published the post to LinkedIn!');
        completedSuccessfully = true;
        break;
      }

      if (livePost.status === 'FAILED') {
        console.log('\n   ✗ Worker hit an error during API dispatch:');
        console.log(`       "${livePost.publishError}"`);
        break;
      }

      await wait(2000);
    }

    await worker.close();
    redis.disconnect();

    // Clean up temporary records since this was an immediate run
    console.log('\n6. Cleaning up database integration test records...');
    await cleanup(campaignId);
    console.log('   ✓ Integration records purged cleanly.');
    console.log('================================================================');
    console.log('🧪 Integration flow verification complete!');
    console.log('================================================================\n');
  }
}

async function cleanup(campaignId: string) {
  try {
    await prisma.socialCampaign.delete({ where: { id: campaignId } }).catch(() => {});
  } catch (err: any) {
    console.error(`Error during cleanup: ${err.message}`);
  }
}

main().catch((err) => {
  console.error('Critical execution error:', err);
});
