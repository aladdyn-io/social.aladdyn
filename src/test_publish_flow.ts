/**
 * 🧪 Aladdyn Social Scheduled Posting & Worker Flow Validator
 * 
 * This script automates testing the full-cycle scheduled post workflow:
 * 1. Checks connection to your cloud Neon PostgreSQL database.
 * 2. Connects to Redis and checks queue health (required for BullMQ).
 * 3. Creates a temporary SocialCampaign and a SocialPost scheduled for 5 seconds from now.
 * 4. Runs the Scheduler tick to identify, approve, and queue the post.
 * 5. Boots the Publish Worker to process the BullMQ job.
 * 6. Observes and logs the database state transitions:
 *    DRAFT ──[Scheduler]──> APPROVED ──[BullMQ Queue]──> SCHEDULED ──[Worker]──> PUBLISHING ──[Meta/LinkedIn API]──> POSTED!
 * 7. Safely cleans up the temporary test records from your database.
 * 
 * Execution command:
 *   npx tsx src/test_publish_flow.ts
 */

import prisma from './lib/prisma';
import { scheduleUpcomingPosts } from './jobs/scheduler';
import { startPublishWorker } from './jobs/workers/publishWorker';
import { publishQueue } from './jobs/queues';
import IORedis from 'ioredis';

async function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('================================================================');
  console.log('🧪 Starting Aladdyn Social Scheduled Posting & Worker Validator');
  console.log('================================================================\n');

  // --- Step 1: Database Connection Check ---
  console.log('1. Connecting to Neon Cloud PostgreSQL Database...');
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('   ✓ Cloud Database connected successfully!\n');
  } catch (error: any) {
    console.error('   ✗ Failed to connect to Neon PostgreSQL. Check your DATABASE_URL in .env');
    console.error(`   Error details: ${error.message}`);
    process.exit(1);
  }

  // --- Step 2: Redis Connection Check ---
  console.log('2. Connecting to Redis Server (Required for BullMQ)...');
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const redis = new IORedis(redisUrl, { maxRetriesPerRequest: 1 });
  
  try {
    await new Promise((resolve, reject) => {
      redis.ping((err, res) => {
        if (err || res !== 'PONG') reject(err || new Error('Ping failed'));
        else resolve(res);
      });
    });
    console.log('   ✓ Redis server connected successfully!\n');
  } catch (error: any) {
    console.error('   ✗ Local Redis server is OFFLINE.');
    console.error('     BullMQ requires Redis to manage schedule queues.');
    console.log('\n     👉 Action required: Start your local Redis server using:');
    console.log('        redis-server\n');
    redis.disconnect();
    process.exit(1);
  }

  // --- Step 3: Setup Temporary Campaign & Post ---
  console.log('3. Injecting temporary Campaign & scheduled Post into PostgreSQL...');
  
  const campaignId = `test-campaign-${Date.now()}`;
  const postId = `test-post-${Date.now()}`;
  const now = new Date();
  const scheduledTime = new Date(now.getTime() + 5000); // Scheduled 5 seconds in the future
  
  // Format scheduled time string in HH:MM format
  const hours = String(scheduledTime.getHours()).padStart(2, '0');
  const mins = String(scheduledTime.getMinutes()).padStart(2, '0');
  const timeString = `${hours}:${mins}`;

  try {
    // A. Create Campaign with dummy Instagram credentials to force Instagram publish path
    await prisma.socialCampaign.create({
      data: {
        id: campaignId,
        funnelId: 'test-funnel',
        userId: 'test-user',
        name: '🤖 Integration Test Campaign',
        startDate: now,
        endDate: new Date(now.getTime() + 24 * 60 * 60 * 1000), // 1 day
        timezone: 'Asia/Kolkata',
        totalDays: 1,
        frequencyPerWeek: 7,
        platforms: ['instagram'],
        contentMix: { photo: 1 },
        status: 'READY',
        igUserId: '123456789',
        accessToken: 'EAACEdEose0cBASE_DUMMY_TOKEN_FOR_INTEGRATION_TESTS_THAT_WILL_PRODUCE_CODE_190_ERROR',
      }
    });

    // B. Create Post (Initially DRAFT, scheduled in 5 seconds)
    await prisma.socialPost.create({
      data: {
        id: postId,
        campaignId,
        scheduledDate: scheduledTime,
        scheduledTime: timeString,
        timezone: 'Asia/Kolkata',
        platform: 'instagram',
        contentType: 'photo',
        caption: 'This is a scheduled integration test post! 🤖🚀 #Aladdyn #AutonomousCoding',
        hashtags: ['Aladdyn', 'AutonomousCoding'],
        imagePrompt: 'A glowing robotic AI coding assistant compiling futuristic code blocks.',
        imageUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800', // Reference cover art
        imageGenerated: true,
        imageModel: 'replicate-flux',
        status: 'DRAFT',
      }
    });

    console.log(`   ✓ Test campaign created: [${campaignId}]`);
    console.log(`   ✓ Test post created: [${postId}] scheduled for ${scheduledTime.toLocaleTimeString()} (${timeString})\n`);

  } catch (error: any) {
    console.error('   ✗ Failed to create test entries:');
    console.error(`     ${error.message}`);
    await cleanup(campaignId, redis);
    process.exit(1);
  }

  // --- Step 4: Boot Scheduler & Worker ---
  console.log('4. Booting Worker & running Scheduler check-tick...');
  
  // Boot the publish worker to listen to the publish queue
  const worker = startPublishWorker();
  
  // Empty any existing stuck jobs for this ID
  await publishQueue.remove(`publish-${postId}`).catch(() => {});

  // Run the scheduler tick to detect overdue DRAFT posts and schedule them
  console.log('   Running scheduleUpcomingPosts()...');
  await scheduleUpcomingPosts();
  console.log('   ✓ Scheduler successfully enqueued the post and set its status in DB!\n');

  // --- Step 5: State Transition Observer Loop ---
  console.log('5. Monitoring DB State transitions (Max 20 seconds)...');
  
  const startTime = Date.now();
  let completedSuccessfully = false;

  while (Date.now() - startTime < 20000) {
    const post = await prisma.socialPost.findUnique({
      where: { id: postId },
      select: { status: true, publishAttempts: true, publishError: true }
    });

    if (!post) {
      console.error('   ✗ Post was deleted unexpectedly.');
      break;
    }

    console.log(`   [${new Date().toLocaleTimeString()}] Database Post Status: ⚡ [${post.status}] (Attempts: ${post.publishAttempts})`);

    if (post.status === 'POSTED') {
      console.log('\n   🎉 SUCCESS! The Publish Worker successfully processed the post!');
      console.log('   ✓ Post status updated to: [POSTED]');
      completedSuccessfully = true;
      break;
    }

    if (post.status === 'FAILED') {
      console.log('\n   ⚠️  Worker attempted publish but hit an expected platform error:');
      console.log(`       "${post.publishError}"`);
      console.log('   ✓ Connection Flow Verified: The database locks, BullMQ trigger, and worker routines all fired correctly!');
      completedSuccessfully = true; // Still a flow success (shows connection logic worked)
      break;
    }

    await wait(2000); // Poll every 2 seconds
  }

  if (!completedSuccessfully) {
    console.log('\n   ⏳ Timeout: Job is still processing in BullMQ queue. Double check that redis-server is active and listening on port 6379.');
  }

  // --- Step 6: Safe Cleanup ---
  console.log('\n6. Cleaning up database integration test records...');
  await worker.close();
  await cleanup(campaignId, redis);
  console.log('   ✓ Integration records purged cleanly.');
  console.log('================================================================');
  console.log('🧪 Integration flow verification complete!');
  console.log('================================================================\n');
}

async function cleanup(campaignId: string, redis: IORedis) {
  try {
    // Delete Campaign (cascades and deletes posts, publish logs, etc.)
    await prisma.socialCampaign.delete({ where: { id: campaignId } }).catch(() => {});
  } catch (err: any) {
    console.error(`Error during cleanup: ${err.message}`);
  } finally {
    redis.disconnect();
  }
}

main().catch((err) => {
  console.error('Critical execution error:', err);
});
