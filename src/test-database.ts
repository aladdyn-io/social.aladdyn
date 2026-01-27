/**
 * Test Database Operations
 * 
 * Simple script to test database read/write functions
 */

import 'dotenv/config';
import {
  getCampaignFromDB,
  savePostsToDB,
  getPostsByCampaign,
  getPostsByDate,
} from './db/database';
import { PostItem } from './types/content';

async function testDatabaseOperations() {
  console.log('============================================================================');
  console.log('Testing Database Operations');
  console.log('============================================================================\n');

  try {
    // ========================================================================
    // TEST 1: Read Campaign
    // ========================================================================
    console.log('TEST 1: Reading campaign from database...');
    const campaignId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const campaign = await getCampaignFromDB(campaignId);
    console.log('✓ Campaign found:', campaign.industry, '-', campaign.services.join(', '));
    console.log('');

    // ========================================================================
    // TEST 2: Save Posts
    // ========================================================================
    console.log('TEST 2: Saving test posts to database...');
    
    const testPosts: PostItem[] = [
      {
        entryId: 'test-1',
        scheduledDate: new Date('2026-02-01'),
        caption: 'Test caption 1 - Transformations post about fitness journey',
        hashtags: ['#fitness', '#transformation', '#health'],
        callToAction: 'Book your free consultation today!',
        imageUrl: 'https://picsum.photos/seed/test1/1024/1024',
        metadata: {
          contentPillar: 'Transformations',
          generatedAt: new Date(),
          imagePrompt: 'Fitness transformation before and after',
          imageModel: 'test-model',
        },
      },
      {
        entryId: 'test-2',
        scheduledDate: new Date('2026-02-02'),
        caption: 'Test caption 2 - Nutrition tips for healthy living',
        hashtags: ['#nutrition', '#healthy', '#wellness'],
        callToAction: 'Join our nutrition program!',
        imageUrl: 'https://picsum.photos/seed/test2/1024/1024',
        metadata: {
          contentPillar: 'Nutrition Tips',
          generatedAt: new Date(),
          imagePrompt: 'Healthy meal prep with fresh vegetables',
          imageModel: 'test-model',
        },
      },
    ];

    const savedIds = await savePostsToDB(campaignId, testPosts);
    console.log('✓ Saved', savedIds.length, 'posts with IDs:', savedIds);
    console.log('');

    // ========================================================================
    // TEST 3: Read All Posts for Campaign
    // ========================================================================
    console.log('TEST 3: Reading all posts for campaign...');
    const allPosts = await getPostsByCampaign(campaignId);
    console.log('✓ Found', allPosts.length, 'total posts');
    allPosts.forEach((post, i) => {
      console.log(`  ${i + 1}. ${post.scheduled_date} - ${post.content_pillar} - ${post.caption.substring(0, 50)}...`);
    });
    console.log('');

    // ========================================================================
    // TEST 4: Read Posts for Specific Date
    // ========================================================================
    console.log('TEST 4: Reading posts for specific date (2026-02-01)...');
    const datePosts = await getPostsByDate(campaignId, '2026-02-01');
    console.log('✓ Found', datePosts.length, 'posts for 2026-02-01');
    datePosts.forEach((post, i) => {
      console.log(`  ${i + 1}. ${post.caption.substring(0, 60)}...`);
    });
    console.log('');

    console.log('============================================================================');
    console.log('✅ All database tests passed!');
    console.log('============================================================================');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

// Run tests
testDatabaseOperations();
