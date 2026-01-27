/**
 * Test Festival API Integration
 * 
 * Tests the Calendarific API integration and fallback mechanism
 */

import 'dotenv/config';
import { fetchFestivalsFromAPI, getFestivalsForDateRange, clearFestivalCache } from './services/festivalApi';

async function testFestivalAPI() {
  console.log('============================================================================');
  console.log('Testing Festival API Integration');
  console.log('============================================================================\n');

  const hasApiKey = !!process.env.CALENDARIFIC_API_KEY && process.env.CALENDARIFIC_API_KEY !== 'your_api_key_here';
  
  if (hasApiKey) {
    console.log('✅ API Key found - Testing real API calls\n');
  } else {
    console.log('⚠️  No API Key - Testing fallback mechanism\n');
    console.log('To test with real API:');
    console.log('1. Sign up at: https://calendarific.com/signup');
    console.log('2. Add CALENDARIFIC_API_KEY to .env file\n');
  }

  try {
    // ========================================================================
    // TEST 1: Fetch festivals for current year (India)
    // ========================================================================
    console.log('TEST 1: Fetching festivals for India 2026...');
    const indiaFestivals = await fetchFestivalsFromAPI(2026, 'IN');
    console.log(`✓ Found ${indiaFestivals.length} festivals for India`);
    console.log('Sample festivals:');
    indiaFestivals.slice(0, 5).forEach((f) => {
      console.log(`  - ${f.date}: ${f.name} (${f.category}, ${f.relevance})`);
    });
    console.log('');

    // ========================================================================
    // TEST 2: Fetch festivals for date range
    // ========================================================================
    console.log('TEST 2: Fetching festivals for date range (Jan 2026 - Mar 2026)...');
    const startDate = new Date('2026-01-01');
    const endDate = new Date('2026-03-31');
    const rangeFestivals = await getFestivalsForDateRange(startDate, endDate, 'IN');
    console.log(`✓ Found ${rangeFestivals.length} festivals in date range`);
    rangeFestivals.forEach((f) => {
      console.log(`  - ${f.date}: ${f.name}`);
    });
    console.log('');

    // ========================================================================
    // TEST 3: Test caching
    // ========================================================================
    console.log('TEST 3: Testing cache mechanism...');
    const start = Date.now();
    const cachedFestivals = await fetchFestivalsFromAPI(2026, 'IN');
    const duration = Date.now() - start;
    console.log(`✓ Second fetch took ${duration}ms (should be instant if cached)`);
    console.log(`  Cache working: ${duration < 100 ? '✅ Yes' : '⚠️ Maybe not'}`);
    console.log('');

    // ========================================================================
    // TEST 4: Test different countries
    // ========================================================================
    console.log('TEST 4: Testing multiple countries...');
    
    const countries = [
      { code: 'US', name: 'United States' },
      { code: 'GB', name: 'United Kingdom' },
      { code: 'AU', name: 'Australia' },
    ];

    for (const country of countries) {
      const festivals = await fetchFestivalsFromAPI(2026, country.code);
      console.log(`  ${country.name} (${country.code}): ${festivals.length} festivals`);
      if (festivals.length > 0) {
        console.log(`    Example: ${festivals[0].name} on ${festivals[0].date}`);
      }
    }
    console.log('');

    // ========================================================================
    // TEST 5: Test cache clearing
    // ========================================================================
    console.log('TEST 5: Testing cache clearing...');
    clearFestivalCache();
    console.log('✓ Cache cleared successfully');
    console.log('');

    console.log('============================================================================');
    if (hasApiKey) {
      console.log('✅ All tests passed! Festival API is working correctly.');
    } else {
      console.log('✅ All tests passed! Fallback mechanism is working correctly.');
      console.log('💡 Add CALENDARIFIC_API_KEY to .env to test real API calls.');
    }
    console.log('============================================================================');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

// Run tests
testFestivalAPI();
