# Content Generation API - Prompt-Based Image Workflow

## 🎯 New Workflow Overview

The system now supports **prompt-based image generation** with on-demand rendering:

### OLD WORKFLOW (Slow):

1. User hits generate content
2. System generates captions + images for ALL posts
3. Uploads all images to storage
4. Returns everything (takes 5-10 minutes for 30 posts)

### NEW WORKFLOW (Fast):

1. User hits generate content
2. System generates captions + **detailed image prompts** (NO images)
3. Returns posts with captions, hashtags, prompts **without images** (30 seconds)
4. User reviews posts and selects specific dates
5. User requests image generation for specific posts
6. System generates only requested images

### Benefits:

- ⚡ **10x faster** batch content generation
- 🎯 **More accurate** images (user selects what to generate)
- 💰 **Cost efficient** (generate only needed images)
- ✅ **Better UX** (see content immediately, generate images selectively)

---

## 📋 API Endpoints

### 1. Generate Content (Batch)

**POST** `/api/v1/generate-content`

Generates complete content batch with captions and prompts (NO images).

**Request Body:**

```json
{
  "input": {
    "industry": "Fitness",
    "total_days": 30,
    "frequency_per_week": 3,
    "festival_enabled": true,
    "services": ["Personal Training", "Group Classes"],
    "geography": "India",
    "logo_url": "https://example.com/logo.png",
    "font_style": "Roboto",
    "accent_color": "#FF6B35",
    "base_color": "#004E89"
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "campaignId": "uuid-here",
    "strategy": { ... },
    "calendar": [ ... ],
    "posts": [
      {
        "entryId": "2026-01-29-Education",
        "scheduledDate": "2026-01-29T00:00:00.000Z",
        "caption": "Transform your fitness journey...",
        "hashtags": ["#Fitness", "#Health"],
        "detailedImagePrompt": "Professional fitness studio interior...",
        "imageUrl": null,  // ← NO IMAGE YET
        "metadata": {
          "topic": "Morning Workout Benefits",
          "contentPillar": "Education",
          "imageGenerated": false  // ← Not generated
        }
      }
    ]
  },
  "meta": {
    "timestamp": "2026-01-29T10:00:00.000Z",
    "processingTime": "25000ms"
  }
}
```

---

### 2. Generate Image for Single Post (On-Demand)

**POST** `/api/v1/posts/:postId/generate-image`

Generates image for a specific post using its detailed prompt.

**Request:**

```http
POST /api/v1/posts/abc-123-def/generate-image
```

**Response:**

```json
{
  "success": true,
  "data": {
    "postId": "abc-123-def",
    "imageUrl": "https://bucket.example.com/posts/abc-123-def/image.png",
    "message": "Image generated successfully",
    "generatedAt": "2026-01-29T10:05:00.000Z"
  },
  "meta": {
    "timestamp": "2026-01-29T10:05:00.000Z",
    "processingTime": "8500ms"
  }
}
```

---

### 3. Batch Generate Images for Multiple Posts

**POST** `/api/v1/posts/generate-images/batch`

Generate images for multiple posts at once.

**Request Body:**

```json
{
  "postIds": ["abc-123-def", "ghi-456-jkl", "mno-789-pqr"]
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "totalRequested": 3,
    "successCount": 3,
    "failureCount": 0,
    "results": [
      {
        "postId": "abc-123-def",
        "success": true,
        "imageUrl": "https://bucket.example.com/posts/abc-123-def/image.png"
      },
      {
        "postId": "ghi-456-jkl",
        "success": true,
        "imageUrl": "https://bucket.example.com/posts/ghi-456-jkl/image.png"
      },
      {
        "postId": "mno-789-pqr",
        "success": true,
        "imageUrl": "https://bucket.example.com/posts/mno-789-pqr/image.png"
      }
    ]
  },
  "meta": {
    "timestamp": "2026-01-29T10:10:00.000Z",
    "processingTime": "24000ms"
  }
}
```

---

### 4. Get Campaign Posts

**GET** `/api/v1/campaigns/:campaignId/posts`

Retrieve all posts for a campaign (with or without images).

**Query Parameters:**

- `date` (optional): Filter by specific date (YYYY-MM-DD)

**Response:**

```json
{
  "success": true,
  "data": {
    "campaignId": "uuid-here",
    "totalPosts": 30,
    "posts": [
      {
        "post_id": "abc-123-def",
        "scheduled_date": "2026-01-29",
        "caption": "Transform your fitness journey...",
        "hashtags": ["#Fitness", "#Health"],
        "detailed_image_prompt": "Professional fitness studio...",
        "image_url": "https://bucket.example.com/...", // or null
        "image_model": "local", // or null if not generated
        "content_pillar": "Education",
        "topic": "Morning Workout Benefits",
        "created_at": "2026-01-29T10:00:00.000Z"
      }
    ]
  }
}
```

---

## 🔄 Typical User Workflow

### Step 1: Generate Content Batch

```bash
curl -X POST http://localhost:3000/api/v1/generate-content \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "industry": "Fitness",
      "total_days": 30,
      "frequency_per_week": 3,
      "festival_enabled": true,
      "services": ["Personal Training"],
      "geography": "India",
      "logo_url": "https://example.com/logo.png",
      "font_style": "Roboto",
      "accent_color": "#FF6B35",
      "base_color": "#004E89"
    }
  }'
```

**Result:** Get 30 posts with captions and prompts in ~30 seconds

### Step 2: Review Posts

User reviews all posts and decides which images to generate

### Step 3: Generate Specific Images

```bash
# Generate image for January 29 post
curl -X POST http://localhost:3000/api/v1/posts/abc-123-def/generate-image

# Or batch generate for multiple dates
curl -X POST http://localhost:3000/api/v1/posts/generate-images/batch \
  -H "Content-Type: application/json" \
  -d '{
    "postIds": ["abc-123-def", "ghi-456-jkl", "mno-789-pqr"]
  }'
```

**Result:** Images generated only for selected posts

---

## 💾 Database Schema Updates

### Posts Table Fields:

| Field                   | Type                    | Description                                         |
| ----------------------- | ----------------------- | --------------------------------------------------- |
| `detailed_image_prompt` | TEXT                    | Comprehensive prompt (layout, lighting, text, etc.) |
| `image_url`             | TEXT (nullable)         | Public URL (null until generated)                   |
| `image_model`           | VARCHAR(100) (nullable) | Model used (null until generated)                   |

---

## 🎨 What's in a Detailed Image Prompt?

The system generates comprehensive prompts including:

1. **Main Subject**: Core theme and visual concept
2. **Composition**: Layout, rule of thirds, focal point
3. **Lighting**: Natural, warm, dramatic, etc.
4. **Color Palette**: Brand colors integrated
5. **Typography**: Text placement and style
6. **Mood & Atmosphere**: Professional, vibrant, etc.
7. **Format**: Social media ready (1:1 aspect ratio)
8. **Text Overlays**: Specific text to include

Example:

```
Professional fitness studio interior with modern equipment and bright natural lighting.
Composition: Rule of thirds with trainer demonstrating exercise in left third, empty
space on right for text overlay. Lighting: Warm natural light from large windows,
golden hour glow. Color palette: Primary #FF6B35 accent on equipment, #004E89 blue
wall backdrop. Typography: Large bold "Morning Workout Benefits" text overlay in top
right, Roboto font, white text with subtle shadow. Mood: Energetic, motivational,
professional. Format: Square 1:1 for Instagram, high quality, marketing-ready.
```

---

## ⚙️ Configuration

Set image generation provider in `.env`:

```env
# Image provider for on-demand generation
IMAGE_PROVIDER=local   # or replicate, huggingface

# For real AI images (if using replicate)
REPLICATE_API_TOKEN=your-token-here
```

---

## 🚀 Performance Comparison

| Metric                     | Old Workflow          | New Workflow        |
| -------------------------- | --------------------- | ------------------- |
| Initial batch generation   | 5-10 minutes          | 30 seconds          |
| Waiting for all images     | Required              | Not required        |
| User can see content       | After everything done | Immediately         |
| Cost for 30 posts          | ~$1.50 (all images)   | $0 (prompts only)   |
| Generate 5 selected images | N/A                   | ~$0.25 + 40 seconds |
| User control               | None                  | Full control        |

---

## 📝 Notes

- Posts with `imageUrl: null` have prompts ready but no generated image
- User can generate images anytime after batch creation
- Images are cached - regenerating same post returns cached URL
- Detailed prompts ensure consistent, high-quality images when generated
