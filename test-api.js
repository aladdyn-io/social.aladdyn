const http = require('http');

const data = JSON.stringify({
  input: {
    business: "Coffee Shop",
    industry: "Food & Beverage",
    services: ["Coffee", "Pastries"],
    geography: "India",
    start_date: "2026-02-01",
    end_date: "2026-02-28",  // Full month
    total_days: 28,
    frequency_per_week: 5,  // 5 posts per week
    base_color: "#8B4513",
    accent_color: "#D2691E"
  }
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/v1/generate-content',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

console.log('Sending request to generate content...\n');

const req = http.request(options, (res) => {
  let responseData = '';

  res.on('data', (chunk) => {
    responseData += chunk;
  });

  res.on('end', () => {
    try {
      const response = JSON.parse(responseData);
      if (response.success) {
        console.log('✅ SUCCESS!');
        console.log(`Total Posts: ${response.data.summary.totalPosts}`);
        console.log(`Processing Time: ${(response.data.summary.processingTime / 1000).toFixed(1)}s`);
        console.log(`Image Model: ${response.data.posts[0].metadata.imageModel}`);
        console.log(`\nFirst Post:`);
        console.log(`  Date: ${response.data.posts[0].scheduledDate.substring(0, 10)}`);
        console.log(`  Pillar: ${response.data.posts[0].metadata.contentPillar}`);
        console.log(`  Caption: ${response.data.posts[0].caption.substring(0, 100)}...`);
      } else {
        console.log('❌ Error:', response.error);
      }
    } catch (e) {
      console.log('Response:', responseData);
    }
  });
});

req.on('error', (e) => {
  console.error(`❌ Request failed: ${e.message}`);
  console.log('\nMake sure the server is running: npm run dev');
});

req.write(data);
req.end();
