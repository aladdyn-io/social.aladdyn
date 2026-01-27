/**
 * Simple API Test - Node.js script
 * Tests the API without needing curl
 * 
 * Run: node simple-test.js (make sure server is running first)
 */

const http = require('http');

function testHealth() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/health',
      method: 'GET',
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        console.log('✓ Health Check Response:');
        console.log(JSON.stringify(JSON.parse(data), null, 2));
        resolve(data);
      });
    });

    req.on('error', (error) => {
      console.error('✗ Health check failed:', error.message);
      reject(error);
    });

    req.end();
  });
}

async function main() {
  console.log('================================================================================');
  console.log('Testing API Server');
  console.log('================================================================================\n');

  try {
    await testHealth();
    console.log('\n✓ Server is running and responding!');
  } catch (error) {
    console.error('\n✗ Server test failed');
    console.error('Make sure the server is running: npm run dev');
  }

  console.log('\n================================================================================');
}

main();
