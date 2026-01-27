/**
 * API Test Script
 * 
 * Quick test to verify the API is working
 * Run with: ts-node test-api.ts
 */

import axios from 'axios';

const API_BASE_URL = 'http://localhost:3000';

async function testAPI() {
  console.log('='.repeat(80));
  console.log('API Test Script');
  console.log('='.repeat(80));

  try {
    // Test 1: Health Check
    console.log('\n1. Testing Health Check...');
    const healthResponse = await axios.get(`${API_BASE_URL}/health`);
    console.log('✓ Health check passed');
    console.log('  Status:', healthResponse.data.data.status);

    // Test 2: Test Endpoint
    console.log('\n2. Testing /api/v1/test endpoint...');
    const testResponse = await axios.post(`${API_BASE_URL}/api/v1/test`, {
      test: 'data',
      timestamp: new Date().toISOString(),
    });
    console.log('✓ Test endpoint passed');
    console.log('  Message:', testResponse.data.data.message);

    // Test 3: Generate Content (Small Campaign)
    console.log('\n3. Testing Content Generation...');
    console.log('   Generating 7 days with 2 posts/week (4 posts total)...');
    console.log('   This may take 30-60 seconds...');
    
    const startTime = Date.now();
    const generateResponse = await axios.post(
      `${API_BASE_URL}/api/v1/generate-content`,
      {
        input: {
          industry: 'Coffee Shop',
          total_days: 7,
          frequency_per_week: 2,
          festival_enabled: false,
          logo_url: 'https://example.com/logo.png',
          font_style: 'Poppins',
          accent_color: '#8B4513',
          base_color: '#F5E6D3',
          services: [
            'Specialty Coffee',
            'Fresh Pastries',
            'Cozy Workspace',
          ],
          geography: 'India',
        },
      },
      {
        timeout: 300000, // 5 minute timeout
      }
    );
    const duration = Date.now() - startTime;

    console.log('✓ Content generation completed!');
    console.log(`  Processing time: ${duration}ms (${(duration / 1000).toFixed(1)}s)`);
    console.log('  Summary:');
    console.log(`    - Total posts: ${generateResponse.data.data.summary.totalPosts}`);
    console.log(`    - Strategy pillars: ${generateResponse.data.data.summary.strategyPillars}`);
    console.log(`    - Calendar days: ${generateResponse.data.data.summary.calendarDays}`);
    console.log(`    - Festival posts: ${generateResponse.data.data.summary.festivalPosts}`);

    // Show first post
    if (generateResponse.data.data.output.posts.length > 0) {
      const firstPost = generateResponse.data.data.output.posts[0];
      console.log('\n  First Post Preview:');
      console.log(`    - Date: ${firstPost.date}`);
      console.log(`    - Caption: ${firstPost.caption.substring(0, 100)}...`);
      console.log(`    - Hashtags: ${firstPost.hashtags.slice(0, 3).join(', ')}`);
      console.log(`    - Image URL: ${firstPost.imageUrl}`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('✓ ALL TESTS PASSED');
    console.log('='.repeat(80));
  } catch (error) {
    console.error('\n' + '='.repeat(80));
    console.error('✗ TEST FAILED');
    console.error('='.repeat(80));

    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED') {
        console.error('Error: Cannot connect to API server');
        console.error('Make sure the server is running: npm run dev');
      } else if (error.response) {
        console.error(`Status: ${error.response.status}`);
        console.error('Response:', JSON.stringify(error.response.data, null, 2));
      } else {
        console.error('Error:', error.message);
      }
    } else {
      console.error('Error:', error);
    }
  }
}

// Run tests
testAPI();
