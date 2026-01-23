/**
 * Main Entry Point
 * 
 * This is the application entry point.
 * Example usage demonstrating how to run the pipeline.
 */

import 'dotenv/config';
import { runContentPipeline } from './pipeline/runContentPipeline';
import { ContentInput } from './types/content';

/**
 * Main function - demonstrates pipeline usage
 */
async function main() {
  console.log('='.repeat(80));
  console.log('Content Generation Pipeline - V1');
  console.log('='.repeat(80));

  try {
    // ========================================================================
    // OPTION 1: Read from database
    // ========================================================================
    
    // const campaignId = process.argv[2] || 'default-campaign-id';
    // const dbInput = await getCampaignFromDB(campaignId);

    // ========================================================================
    // OPTION 2: Use sample data (for testing without DB)
    // ========================================================================
    
    const input: ContentInput = {
      industry: 'Digital Marketing Agency',
      total_days: 30,
      frequency_per_week: 3,
      festival_enabled: true,
      logo_url: 'https://example.com/logo.png',
      font_style: 'Montserrat',
      accent_color: '#FF6B35',
      base_color: '#004E89',
      services: [
        'Social Media Management',
        'Content Creation',
        'SEO Optimization',
      ],
      geography: 'India',
    };

    // ========================================================================
    // RUN PIPELINE
    // ========================================================================
    
    console.log('\nStarting pipeline with sample data...\n');
    const result = await runContentPipeline(input);

    // ========================================================================
    // DISPLAY RESULTS
    // ========================================================================
    
    console.log('\n' + '='.repeat(80));
    console.log('PIPELINE RESULTS');
    console.log('='.repeat(80));
    console.log(`Total Posts: ${result.posts.length}`);
    console.log('\nContent Strategy:');
    console.log(`- Tone: ${result.strategy.tone}`);
    console.log(`- CTA Style: ${result.strategy.cta_style}`);
    console.log(`- Content Pillars: ${result.strategy.content_pillars.length}`);
    result.strategy.content_pillars.forEach((pillar) => {
      console.log(`  • ${pillar}`);
    });
    console.log('\nContent Mix:');
    console.log(`- Education: ${result.strategy.content_mix.education}%`);
    console.log(`- Trust Building: ${result.strategy.content_mix.trust}%`);
    console.log(`- Promotion: ${result.strategy.content_mix.promotion}%`);
    console.log('\nCalendar Summary:');
    console.log(`- Total Entries: ${result.calendar.length}`);
    const festivalCount = result.calendar.filter(c => c.is_festival).length;
    console.log(`- Regular Posts: ${result.calendar.length - festivalCount}`);
    console.log(`- Festival Posts: ${festivalCount}`);
    console.log('\nGenerated Posts:');
    result.posts.slice(0, 3).forEach((post, i) => {
      console.log(`\n${i + 1}. ${post.scheduledDate.toISOString().split('T')[0]}`);
      console.log(`   Caption: ${post.caption.substring(0, 100)}...`);
      console.log(`   Hashtags: ${post.hashtags.join(' ')}`);
      console.log(`   Image URL: ${post.imageUrl}`);
    });
    if (result.posts.length > 3) {
      console.log(`\n... and ${result.posts.length - 3} more posts`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('✓ Pipeline completed successfully');
    console.log('='.repeat(80));

    // TODO: Save results to database
    // await savePostsToDB(result.campaignId, result.posts);
  } catch (error) {
    console.error('\n' + '='.repeat(80));
    console.error('✗ Pipeline failed');
    console.error('='.repeat(80));
    console.error(error);
    process.exit(1);
  } finally {
    // Clean up database connections
    try {
      // await closeDatabase();
    } catch (error) {
      console.error('Failed to close database:', error);
    }
  }
}

// Run if this is the main module
if (require.main === module) {
  main();
}

export { main };
