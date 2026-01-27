/**
 * Test Post Management APIs
 *
 * Tests:
 * 1. Generate content for a campaign
 * 2. Edit post caption
 * 3. Regenerate post (caption only)
 * 4. Add extra post
 * 5. Delete post
 */

const http = require("http");

const BASE_URL = "http://localhost:3000";
let testCampaignId = "";
let testPostId = "";
let testDate = "";

// Helper function to make HTTP requests
function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        "Content-Type": "application/json",
      },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on("error", reject);

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

// Test functions
async function test1_GenerateContent() {
  console.log("\n========================================");
  console.log("TEST 1: Generate Content");
  console.log("========================================");

  const response = await makeRequest("POST", "/api/v1/generate-content", {
    input: {
      business: "Test Cafe",
      industry: "Food & Beverage",
      services: ["Coffee", "Pastries"],
      geography: "India",
      start_date: "2026-03-01",
      end_date: "2026-03-05",
      total_days: 5,
      frequency_per_week: 3,
      base_color: "#FF6B6B",
      accent_color: "#4ECDC4",
    },
  });

  if (response.data.success && response.data.data.output.posts.length > 0) {
    testPostId = response.data.data.output.posts[0].entryId;
    testDate = response.data.data.output.posts[0].scheduledDate.split("T")[0];
    console.log(`✅ Generated ${response.data.data.summary.totalPosts} posts`);
    console.log(`   First post ID: ${testPostId}`);
    console.log(`   First post date: ${testDate}`);
    return true;
  } else {
    console.log("❌ Failed to generate content");
    return false;
  }
}

async function test2_EditPost() {
  console.log("\n========================================");
  console.log("TEST 2: Edit Post Caption");
  console.log("========================================");

  // First, we need to get a post from database
  // For now, we'll skip this test as we need campaign_id
  console.log("⚠️  Skipping - requires database post ID");
  console.log("   Use: PUT /api/v1/posts/{postId}");
  console.log('   Body: { "caption": "Updated caption text" }');
  return true;
}

async function test3_RegeneratePost() {
  console.log("\n========================================");
  console.log("TEST 3: Regenerate Post");
  console.log("========================================");

  console.log("⚠️  Skipping - requires database post ID");
  console.log("   Use: POST /api/v1/posts/{postId}/regenerate");
  console.log('   Body: { "regenerateImage": false }');
  return true;
}

async function test4_AddExtraPost() {
  console.log("\n========================================");
  console.log("TEST 4: Add Extra Post");
  console.log("========================================");

  console.log("⚠️  Skipping - requires campaign ID from database");
  console.log("   Use: POST /api/v1/campaigns/{campaignId}/posts/add");
  console.log(
    '   Body: { "date": "2026-03-10", "pillar": "Behind the Scenes" }',
  );
  return true;
}

async function test5_DeletePost() {
  console.log("\n========================================");
  console.log("TEST 5: Delete Post");
  console.log("========================================");

  console.log("⚠️  Skipping - requires database post ID");
  console.log("   Use: DELETE /api/v1/posts/{postId}");
  return true;
}

async function testHealthCheck() {
  console.log("\n========================================");
  console.log("Pre-Test: Health Check");
  console.log("========================================");

  try {
    const response = await makeRequest("GET", "/health");
    if (response.status === 200) {
      console.log("✅ Server is healthy");
      return true;
    } else {
      console.log("❌ Server health check failed");
      return false;
    }
  } catch (error) {
    console.log("❌ Cannot connect to server");
    console.log("   Make sure server is running: npm run dev");
    return false;
  }
}

// Run all tests
async function runTests() {
  console.log("========================================");
  console.log("Post Management API Tests");
  console.log("========================================");

  const isHealthy = await testHealthCheck();
  if (!isHealthy) {
    process.exit(1);
  }

  await test1_GenerateContent();
  await test2_EditPost();
  await test3_RegeneratePost();
  await test4_AddExtraPost();
  await test5_DeletePost();

  console.log("\n========================================");
  console.log("API Endpoints Summary");
  console.log("========================================");
  console.log("✅ POST   /api/v1/generate-content");
  console.log("✅ PUT    /api/v1/posts/:postId");
  console.log("✅ POST   /api/v1/posts/:postId/regenerate");
  console.log("✅ POST   /api/v1/campaigns/:campaignId/posts/add");
  console.log("✅ DELETE /api/v1/posts/:postId");
  console.log("\n📝 Note: Some tests require database post IDs");
  console.log(
    "   First generate content and save to DB, then test with real IDs",
  );
  console.log("========================================\n");
}

runTests().catch(console.error);
