# Demo HTML - Full Cycle Testing Guide

## Overview

The updated `demo.html` provides a comprehensive visual testing suite for the entire Social Scene content generation pipeline. It includes 4 main tabs for testing all system expectations.

## Access the Demo

1. **Start the API server**:

   ```bash
   npm run dev
   ```

2. **Open the demo**:
   ```
   http://localhost:3000/demo.html
   ```
   Or open the file directly in a browser (ensure API is accessible)

---

## 🌐 Secure Tunnels & Meta Developer Portal Setup

To test **Instagram Login (OAuth)** and **Publishing** locally, you must set up secure tunnels. Meta's servers require secure HTTPS URLs for OAuth redirect callbacks and publicly accessible endpoints to fetch images for posting.

### 1. The Architecture
*   **App Server (`localhost:3000`)** ── Proxy via **Cloudflare Tunnel** ── Used for Instagram/LinkedIn OAuth redirects.
*   **MinIO Storage (`localhost:9000`)** ── Proxy via **ngrok** ── Used by Meta's servers to download your generated media assets.

---

### 2. Set Up Cloudflare Tunnel (for Localhost Server)

Cloudflare Tunnels are free, highly stable, and do not expire. They are perfect for OAuth redirect callbacks.

1. **Install Cloudflare CLI (cloudflared):**
   *   **Windows (PowerShell):**
       ```powershell
       winget install Cloudflare.cloudflared
       ```
2. **Start a Tunnel pointing to your app:**
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
3. **Capture the Tunnel URL:**
   Locate the generated URL in the terminal (e.g., `https://zinc-demographic-serum-interpreted.trycloudflare.com`).

---

### 3. Set Up ngrok (for MinIO Media Hosting)

Meta's servers need to access your locally generated images via a public endpoint.

1. **Install ngrok:**
   *   **Windows (PowerShell):**
       ```powershell
       winget install equinusocio.ngrok
       ```
2. **Start the Tunnel pointing to MinIO S3 port (`9000`):**
   ```bash
   ngrok http 9000
   ```
3. **Capture the ngrok URL:**
   Locate your public ngrok URL (e.g., `https://state-contusion-uptake.ngrok-free.dev`).

---

### 4. Update Your `.env` Variables

Open your `.env` file and update the following settings:

```env
# ── META OAUTH REDIRECTS ──
# Use your Cloudflare Tunnel URL for the redirect callback
META_REDIRECT_URI="https://<YOUR_CLOUDFLARE_SUBDOMAIN>.trycloudflare.com/api/v1/auth/meta/callback"

# ── MINIO PUBLIC ASSETS ──
# Use your public ngrok URL so Meta's servers can download images
MINIO_PUBLIC_ENDPOINT="https://<YOUR_NGROK_ID>.ngrok-free.dev"
```

---

### 5. Configure the Meta Developer Portal

To allow Meta to trust your local environment tunnels:

1. **Go to [Meta Developer Portal](https://developers.facebook.com/)** and select your Business/Instagram login app.
2. **Under App Settings > Basic:**
   *   Update **App Domains** with your Cloudflare tunnel domain (e.g., `trycloudflare.com`).
   *   Ensure the Website **Site URL** is set to your active Cloudflare tunnel URL (`https://xxx.trycloudflare.com`).
3. **Under Use Cases > Instagram Business Login > Settings:**
   *   Add your exact `.env` redirect callback URL under **Valid OAuth Redirect URIs**:
       ```
       https://<YOUR_CLOUDFLARE_SUBDOMAIN>.trycloudflare.com/api/v1/auth/meta/callback
       ```
4. **Under App Settings > Advanced:**
   *   Ensure **Share Redirect URI list** or **Strict Mode** matches your exact tunnel redirect URL.

---

### 6. Run and Test the Flow

1. Restart the node server:
   ```bash
   npm run dev
   ```
2. Open your Cloudflare Tunnel URL in your browser:
   ```
   https://<YOUR_CLOUDFLARE_SUBDOMAIN>.trycloudflare.com/demo.html
   ```
3. Generate a campaign.
4. Click **"Connect Instagram"** (uses the Cloudflare redirect loop seamlessly).
5. Open your generated post and hit **Publish**! Meta will reach into your MinIO instance via the ngrok tunnel, pull the image, and publish it live!

---


## Features

### 🚀 Tab 1: Generate Content

**Purpose**: Manual content generation with full UI interaction

**What You Can Test**:

- ✅ Campaign creation with custom inputs
- ✅ View generated posts in grid layout
- ✅ Toggle between Card Grid and Calendar Planner views
- ✅ Chronological calendar slot indicators, platform tags (IG / LN), and render status indicators
- ✅ Interactive cross-scroll scroll and card flash highlight synchronization
- ✅ Edit post captions inline
- ✅ Regenerate post captions (uses persisted data)
- ✅ Regenerate posts with new images
- ✅ Delete posts (purges database records and purges MinIO storage assets in cascade)
- ✅ Add extra posts for specific dates
- ✅ View real-time processing times
- ✅ See content pillar distribution

**Expected Behavior**:

1. Fill in industry, services, duration, geography
2. Click "Generate Content" → Wait 30-90 seconds
3. View posts in grid layout
4. Click the **📅 Calendar Planner** tab to view your chronological monthly posting grids:
   - View scheduled post tiles with platform-specific branding (`IG` in Pink, `LN` in Blue)
   - View render status dots (Green for rendered images, Yellow for pending/on-demand)
   - Click a calendar tile → switches view and scrolls smoothly to flash a high-contrast target border
5. Each post shows:
   - Generated image with depth compositing
   - Caption with hashtags
   - Scheduled date
   - Management buttons (Edit, Regenerate, Delete)
6. Test all management operations

**Key Validations**:

- No duplicate topics in generated posts (sequential generation)
- Post regeneration preserves context (uses calendar_entry_id)
- Edits persist in database
- UI updates immediately after operations

---

### 🧪 Tab 2: Full Cycle Tests

**Purpose**: Automated testing of all system expectations

**What It Tests**:

1. **API Health Check** (⏱️ ~100ms)
   - Verifies server is running
   - Checks service availability
   - Expected: `status: 'ok'`

2. **Generate Campaign** (⏱️ ~30-90s)
   - Creates 7-day campaign with 3 posts/week
   - Generates strategy, calendar, and posts
   - Expected: Posts array length > 0, strategy pillars > 0

3. **Strategy Cached** (⏱️ ~50ms)
   - Verifies strategy is cached for reuse
   - Expected: Cache sets > 0

4. **Edit Post Caption** (⏱️ ~200ms)
   - Updates first post's caption
   - Expected: Success response with updated post

5. **Regenerate Post Caption** (⏱️ ~3-5s)
   - Generates new caption using persisted calendar data
   - Tests that calendar_entry_id is used (not reconstructed)
   - Expected: New caption returned, different from original

6. **Add Extra Post** (⏱️ ~5-8s)
   - Creates additional post for tomorrow
   - Generates caption + image prompt
   - Expected: New post created with valid ID

7. **Delete Post** (⏱️ ~100ms)
   - Removes the extra post from database
   - Expected: Success response

8. **Cache Performance** (⏱️ ~50ms)
   - Checks cache hit rate
   - Expected: Hit rate ≥ 0% (any value is valid)

**How to Run**:

1. Switch to "Full Cycle Tests" tab
2. Click "Run All Tests"
3. Watch progress indicators (⏳ → ✅ or ❌)
4. View summary with pass/fail counts

**Expected Results**:

- **8/8 tests passed** (100% success rate)
- Total time: ~40-100 seconds (depending on LLM response times)
- All tests show ✅ green checkmarks

**Troubleshooting**:

- If "API Health Check" fails: Start server with `npm run dev`
- If "Generate Campaign" times out: Check OpenAI API key in `.env`
- If "Cache" tests fail: Verify cache endpoints are enabled

---

### 💾 Tab 3: Cache Management

**Purpose**: Monitor and manage the caching layer

**Cache Statistics**:

- **Hits**: Number of cache hits (data retrieved from cache)
- **Misses**: Number of cache misses (data fetched from source)
- **Hit Rate**: Percentage of requests served from cache
- **Size**: Current number of entries in cache
- **Evictions**: Number of expired entries removed
- **Sets**: Total cache write operations

**Expected Values** (after running tests):

- Hits: 2-5 (strategy, festivals)
- Misses: 5-10 (first-time data)
- Hit Rate: 20-60% (depends on test sequence)
- Size: 3-8 entries
- Evictions: 0-2
- Sets: 5-10

**Clear Cache**:

- Clear all: Leave pattern empty
- Clear specific: Enter pattern like `strategy`, `festival`, etc.

**Use Cases**:

1. **Before performance testing**: Clear cache to test cold start
2. **After business changes**: Clear strategy cache when industry changes
3. **Debugging**: Clear all to reset state

---

### 📚 Tab 4: Documentation

**Purpose**: Quick reference for all API endpoints

**Sections**:

1. **Core Endpoints**: Health check, content generation
2. **Post Management**: Edit, regenerate, delete, add posts
3. **Cache Management**: Stats, clear cache
4. **Performance Metrics**: Phase 1-3 improvements

---

## Visual Expectations

### Post Cards

Each post card displays:

```
┌─────────────────────────────┐
│   [Generated Image]         │
│                             │
├─────────────────────────────┤
│ Post 1 • Jan 29, 2026       │
│                             │
│ Caption text with emojis... │
│                             │
│ #Tag1 #Tag2 #Tag3           │
│                             │
│ [Post Management]           │
│ ✏️ Edit  🔄 Regen Caption   │
│ 🖼️ Regen All  🗑️ Delete      │
└─────────────────────────────┘
```

### Summary Stats

```
┌──────────────────────────────────────────────┐
│  ✅ Generation Complete!                     │
│                                              │
│  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐  │
│  │   7   │ │   3   │ │   2   │ │  33s  │  │
│  │ Posts │ │Pillars│ │Festival│ │ Time  │  │
│  └───────┘ └───────┘ └───────┘ └───────┘  │
└──────────────────────────────────────────────┘
```

### Test Progress

```
┌─────────────────────────────────────────────┐
│ ✅  API Health Check                  120ms │
│ ✅  Generate Campaign                35.5s  │
│ ✅  Strategy Cached                    48ms │
│ ✅  Edit Post Caption                 215ms │
│ ✅  Regenerate Post Caption          4.2s  │
│ ✅  Add Extra Post                   6.8s  │
│ ✅  Delete Post                       95ms │
│ ✅  Cache Performance                 52ms │
└─────────────────────────────────────────────┘
```

---

## Performance Benchmarks

### Expected Times

| Operation                   | Time (Cold) | Time (Cached)             |
| --------------------------- | ----------- | ------------------------- |
| API Health                  | ~100ms      | ~50ms                     |
| Generate Campaign (7 days)  | ~30-40s     | ~25-30s (strategy cached) |
| Generate Campaign (30 days) | ~90-120s    | ~70-90s (strategy cached) |
| Edit Post                   | ~150-300ms  | N/A                       |
| Regenerate Caption          | ~3-5s       | N/A                       |
| Regenerate All              | ~8-12s      | N/A                       |
| Add Extra Post              | ~5-8s       | N/A                       |
| Delete Post                 | ~50-150ms   | N/A                       |
| Cache Stats                 | ~50ms       | N/A                       |

---

## Test Scenarios

### Scenario 1: Fresh Installation Test

**Goal**: Verify everything works from scratch

**Steps**:

1. Clear cache (Tab 3)
2. Run full cycle tests (Tab 2)
3. Verify 8/8 tests pass
4. Check cache stats show hit rate > 0%

**Expected Results**:

- All tests pass
- Cache hit rate: 20-40%
- Total time: ~50-90 seconds

---

### Scenario 2: Performance Test

**Goal**: Measure caching performance improvement

**Steps**:

1. **Cold Start**:
   - Clear cache
   - Generate campaign (Tab 1)
   - Note processing time

2. **Warm Start**:
   - Generate same campaign again (same industry/geography)
   - Note processing time
   - Should be 15-25% faster

**Expected Results**:

- Cold start: ~30-40s (7-day campaign)
- Warm start: ~25-30s (7-day campaign)
- Cache hit rate: 60-80%

---

### Scenario 3: CRUD Operations Test

**Goal**: Test all post management operations

**Steps**:

1. Generate campaign (Tab 1)
2. **Edit** first post caption
3. **Regenerate caption** for second post
4. **Regenerate all** (caption + image) for third post
5. **Add extra post** for tomorrow
6. **Delete** the extra post

**Expected Results**:

- All operations succeed
- UI updates immediately
- Database reflects changes
- No errors in console

---

### Scenario 4: Duplicate Detection Test

**Goal**: Verify duplicate topics are prevented

**Steps**:

1. Generate 30-day campaign with high frequency
2. Check console logs for duplicate warnings
3. Verify no duplicate topics in generated posts

**Expected Results**:

- Topics are unique across calendar
- If duplicate detected, retries generate new topic
- Max 3 retries before fallback

---

### Scenario 5: Cache Invalidation Test

**Goal**: Test cache clearing functionality

**Steps**:

1. Generate campaign (creates cache entries)
2. Check cache stats (size > 0)
3. Clear cache with pattern "strategy"
4. Check cache stats (strategy entries removed)
5. Clear all cache
6. Check cache stats (size = 0)

**Expected Results**:

- Cache size decreases after pattern clear
- Cache size = 0 after clear all
- Operations still work after cache clear

---

### Scenario 6: Liquid HTML Dynamic Layout Testing

**Goal**: Verify the system generates and captures custom Tailwind overlays on-the-fly

**Steps**:

1. Run a campaign generation (Tab 1)
2. Choose a generated post focusing on customer reviews, testimonials, or high-impact promotions
3. Click the on-demand composite generation button
4. Verify the composite image:
   - Check if custom fonts like `Lobster` or `Pacifico` are loaded.
   - Verify that punchy keywords are styled with custom highlight colors.
   - Confirm star rating headers (`★★★★★`) or verified user quote bubbles are embedded dynamically.

---

## Troubleshooting

### Test Failures

**"API Health Check" Fails**

- **Cause**: Server not running
- **Fix**: Run `npm run dev` in terminal
- **Verify**: Check `http://localhost:3000/health` directly

**"Generate Campaign" Fails**

- **Cause**: Missing OpenAI API key or database connection
- **Fix**: Check `.env` file has `OPENAI_API_KEY` and `DATABASE_URL`
- **Verify**: Check server logs for errors

**"Edit Post Caption" Fails**

- **Cause**: Post ID not found or database issue
- **Fix**: Verify post exists in database

**"Regenerate Post Caption" Fails**

- **Cause**: Missing calendar_entry_id in post record
- **Fix**: Regenerate campaign or check database schema

**"Cache Performance" Fails**

- **Cause**: Cache endpoints not enabled
- **Fix**: Verify cache.ts is imported in server.ts

### Performance Issues

**Slow Generation (>2 minutes)**

- Check OpenAI API rate limits
- Verify network connection
- Check server logs for errors

**Low Cache Hit Rate (<20%)**

- Each test run uses different campaigns
- Cache keys include industry/geography/brand_stage
- Normal for varied testing

**UI Not Updating**

- Check browser console for JavaScript errors
- Verify API responses are successful
- Clear browser cache and reload
- Check network tab for failed requests

---

## Success Criteria

### ✅ Demo is Working If:

1. **All 4 tabs are accessible** and load without errors
2. **Generate Content tab** creates posts with images
3. **Full Cycle Tests tab** shows 8/8 tests passed
4. **Cache Management tab** displays statistics
5. **Documentation tab** shows endpoint reference
6. **All CRUD operations** succeed (edit, regenerate, delete, add)
7. **Cache hit rate** improves on repeated operations
8. **No console errors** during normal usage
9. **Performance metrics** match expected benchmarks
10. **Visual feedback** works (success messages, loading spinners)
11. **Dynamic HTML overlays** render custom typographic accents beautifully

---

## Next Steps

After verifying the demo works:

1. **Production Testing**: Test with longer campaigns (30+ days)
2. **Load Testing**: Generate multiple campaigns simultaneously
3. **Error Recovery**: Test with invalid inputs
4. **Edge Cases**: Test with extreme values (90 days, 7 posts/week)
5. **Cache Stress Test**: Generate 100+ campaigns to test cache limits

---

## Summary

The updated `demo.html` provides:

✅ **Visual testing** of all features  
✅ **Automated test suite** for full cycle validation  
✅ **Cache management** UI  
✅ **Performance metrics** display  
✅ **Comprehensive documentation**
