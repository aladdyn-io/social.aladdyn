/**
 * 👔 Real LinkedIn Authorization & Live Posting Test Tool
 * 
 * This tool automates the full LinkedIn OAuth flow and makes a real test post:
 * 1. Launches a temporary Express server on http://localhost:8080 to listen for the redirect.
 * 2. Generates the custom authorization URL with 'openid profile w_member_social' scopes.
 * 3. Prompts you to log in in your browser.
 * 4. Captures the authorization code, exchanges it for an Access Token.
 * 5. Queries your Person URN and publishes a real post to your feed!
 */

import express from 'express';
import axios from 'axios';
import http from 'http';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environmental variables
dotenv.config();

// --- YOUR CREDENTIALS (Retrieved securely from environment variables) ---
const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || '';
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || '';
const REDIRECT_URI = 'http://localhost:8080/callback';
const PORT = 8080;

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('❌ ERROR: LinkedIn credentials missing!');
    console.error('   Please make sure to define the following keys in your .env file:');
    console.error('   LINKEDIN_CLIENT_ID="your_client_id"');
    console.error('   LINKEDIN_CLIENT_SECRET="your_client_secret"\n');
    process.exit(1);
  }

  console.log('================================================================');
  console.log('👔 Aladdyn Social: Real LinkedIn Live Posting Setup & Validator');
  console.log('================================================================\n');

  console.log('⚠️ IMPORTANT STEP FIRST:');
  console.log('   Before running this, you MUST register this redirect URL in your');
  console.log('   LinkedIn Developer Portal under your App Settings -> Auth ->');
  console.log('   "Authorized Redirect URLs for your app":');
  console.log(`   👉 ${REDIRECT_URI}\n`);

  console.log('1. Starting temporary local OAuth receiver server...');
  const app = express();
  let server: http.Server;

  const authCodePromise = new Promise<string>((resolve) => {
    app.get('/callback', (req, res) => {
      const code = req.query.code as string;
      const error = req.query.error as string;

      if (error) {
        res.status(400).send(`<h3>Authentication Failed!</h3><p>Reason: ${error}</p>`);
        console.error(`\n❌ Authorization failed: ${error}`);
        process.exit(1);
      }

      res.send(`
        <div style="font-family: system-ui, sans-serif; text-align: center; padding: 40px; background: #f4f6f8; min-height: 100vh;">
          <div style="background: white; padding: 30px; border-radius: 12px; display: inline-block; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
            <h2 style="color: #0a66c2;">✓ Authorized Successfully!</h2>
            <p>You can close this tab and return to the terminal.</p>
          </div>
        </div>
      `);
      resolve(code);
    });
  });

  server = app.listen(PORT, () => {
    console.log(`   ✓ Local OAuth server listening on port ${PORT}\n`);
  });

  // Generate Authorization URL
  const scopes = encodeURIComponent('openid profile w_member_social');
  const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scopes}`;

  console.log('2. Copy and open this URL in your browser to authorize:');
  console.log('----------------------------------------------------------------');
  console.log(`👉 ${authUrl}`);
  console.log('----------------------------------------------------------------\n');
  console.log('⏳ Waiting for authorization redirect...');

  const authCode = await authCodePromise;
  console.log('\n   ✓ Authorization code received! Exchanging for access token...');

  // Close the server as it is no longer needed
  server.close();

  try {
    // 3. Exchange authorization code for Access Token
    const tokenRes = await axios.post(
      'https://www.linkedin.com/oauth/v2/accessToken',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    const accessToken = tokenRes.data.access_token;
    console.log('   ✓ Access Token acquired successfully!\n');

    // 4. Get User Profile Person URN
    console.log('3. Fetching your LinkedIn Profile Person URN...');
    const profileRes = await axios.get('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const sub = profileRes.data.sub;
    const displayName = `${profileRes.data.given_name} ${profileRes.data.family_name}`;
    const memberUrn = `urn:li:person:${sub}`;
    console.log(`   ✓ Connected User: ${displayName} (${memberUrn})\n`);

    // Auto-save credentials to .env for real worker publishing
    console.log('   Saving credentials directly to .env...');
    const envPath = path.join(__dirname, '../.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf-8');
    }
    envContent = envContent
      .split('\n')
      .filter((line) => !line.startsWith('LINKEDIN_ACCESS_TOKEN=') && !line.startsWith('LINKEDIN_MEMBER_URN='))
      .join('\n')
      .trim();
    envContent += `\n\n# ── LINKEDIN DIRECT TESTING CREDENTIALS ──\nLINKEDIN_ACCESS_TOKEN="${accessToken}"\nLINKEDIN_MEMBER_URN="${memberUrn}"\n`;
    fs.writeFileSync(envPath, envContent, 'utf-8');
    console.log('   ✓ Credentials automatically written to .env file for Worker integration!\n');

    // 5. Publish real Post to LinkedIn
    console.log('4. Publishing a live test post to your LinkedIn Feed...');
    const publishPayload = {
      author: memberUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: {
            text: 'Hello LinkedIn! 🚀🤖\n\nThis is a live test post published using the Aladdyn social campaign scheduling and worker pipeline! Everything is working beautifully.\n\n#Aladdyn #AutonomousCoding #LinkedInAPI #WebEngineering'
          },
          shareMediaCategory: 'NONE'
        }
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
      }
    };

    const publishRes = await axios.post(
      'https://api.linkedin.com/v2/ugcPosts',
      publishPayload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
          'Content-Type': 'application/json'
        }
      }
    );

    const livePostId = publishRes.data.id;
    console.log('\n🎉 SUCCESS! Post published live to your LinkedIn feed!');
    console.log(`   ✓ LinkedIn Post ID: ${livePostId}`);
    console.log('   ✓ Check your profile to see the live post!');
    console.log('=======================================================\n');

  } catch (error: any) {
    console.error('\n❌ Failed to publish to LinkedIn:');
    if (error.response) {
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
  }
}

main().catch((err) => {
  console.error('Critical execution error:', err);
});
