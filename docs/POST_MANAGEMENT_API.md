# Post Management APIs

Complete CRUD operations for managing social media posts.

## Endpoints

### 1. Edit Post

**PUT** `/api/v1/posts/:postId`

Edit post caption, image URL, hashtags, or call-to-action.

**Request Body:**

```json
{
  "caption": "Updated caption text",
  "imageUrl": "https://example.com/new-image.jpg",
  "hashtags": ["#UpdatedTag", "#NewTag"],
  "callToAction": "Check out our new offers!"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "post": {
      /* updated post object */
    },
    "message": "Post updated successfully"
  }
}
```

**Example:**

```bash
curl -X PUT http://localhost:3000/api/v1/posts/550e8400-e29b-41d4-a716-446655440000 \
  -H "Content-Type: application/json" \
  -d '{"caption": "New caption here"}'
```

---

### 2. Regenerate Post

**POST** `/api/v1/posts/:postId/regenerate`

Regenerate post caption and optionally the image using AI.

**Request Body:**

```json
{
  "regenerateImage": false // true to regenerate image too
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "post": {
      /* regenerated post object */
    },
    "message": "Post regenerated successfully"
  }
}
```

**Example:**

```bash
# Regenerate caption only
curl -X POST http://localhost:3000/api/v1/posts/550e8400-e29b-41d4-a716-446655440000/regenerate \
  -H "Content-Type: application/json" \
  -d '{"regenerateImage": false}'

# Regenerate both caption and image
curl -X POST http://localhost:3000/api/v1/posts/550e8400-e29b-41d4-a716-446655440000/regenerate \
  -H "Content-Type: application/json" \
  -d '{"regenerateImage": true}'
```

---

### 3. Delete Post

**DELETE** `/api/v1/posts/:postId`

Permanently delete a post from the database.

**Response:**

```json
{
  "success": true,
  "data": {
    "message": "Post deleted successfully",
    "postId": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

**Example:**

```bash
curl -X DELETE http://localhost:3000/api/v1/posts/550e8400-e29b-41d4-a716-446655440000
```

---

### 4. Add Extra Post

**POST** `/api/v1/campaigns/:campaignId/posts/add`

Add an additional post for a specific date.

**Request Body:**

```json
{
  "date": "2026-03-15", // Required: YYYY-MM-DD
  "pillar": "Behind the Scenes", // Optional: content pillar
  "topic": "Coffee brewing process", // Optional: specific topic
  "isFestival": false, // Optional: festival post
  "festivalName": "International Coffee Day" // Optional: if isFestival = true
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "post": {
      /* newly created post object */
    },
    "message": "Post created successfully"
  }
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/v1/campaigns/123e4567-e89b-12d3-a456-426614174000/posts/add \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2026-03-15",
    "pillar": "Customer Stories",
    "topic": "Customer testimonials about our coffee"
  }'
```

---

## Complete Workflow Example

### Step 1: Generate Content for Campaign

```bash
POST /api/v1/campaigns/123e4567-e89b-12d3-a456-426614174000/generate
```

### Step 2: Get All Posts

```bash
GET /api/v1/campaigns/123e4567-e89b-12d3-a456-426614174000/posts
```

### Step 3: Edit a Post

```bash
PUT /api/v1/posts/550e8400-e29b-41d4-a716-446655440000
Body: { "caption": "Updated caption" }
```

### Step 4: Regenerate a Post

```bash
POST /api/v1/posts/550e8400-e29b-41d4-a716-446655440000/regenerate
Body: { "regenerateImage": false }
```

### Step 5: Add Extra Post

```bash
POST /api/v1/campaigns/123e4567-e89b-12d3-a456-426614174000/posts/add
Body: { "date": "2026-03-20", "pillar": "Tips & Tricks" }
```

### Step 6: Delete a Post

```bash
DELETE /api/v1/posts/550e8400-e29b-41d4-a716-446655440000
```

---

## Service Functions

Backend service functions in `src/services/postManagement.ts`:

### `editPost(postId, updates)`

- Updates post fields in database
- Validates post exists before updating
- Returns updated post object

### `regeneratePost(postId, regenerateImage = false)`

- Fetches campaign data and reconstructs context
- Regenerates caption using AI
- Optionally regenerates image
- Updates post in database

### `deletePost(postId)`

- Validates post exists
- Permanently removes from database
- Returns success status

### `addExtraPost(campaignId, date, options)`

- Fetches campaign data
- Generates caption and image using AI
- Assembles and saves new post
- Returns created post object

---

## Database Functions

New function added to `src/db/database.ts`:

### `getPostById(postId)`

- Fetches single post by UUID
- Returns post object or null if not found
- Used by all post management operations

---

## Error Handling

All endpoints return standard error responses:

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_ERROR",
    "message": "Failed to edit post: Post not found",
    "details": { "postId": "550e8400-..." }
  }
}
```

Common error codes:

- `INVALID_INPUT` - Missing or invalid request parameters
- `DATABASE_ERROR` - Database operation failed
- `PIPELINE_FAILED` - AI generation failed
- `CAMPAIGN_NOT_FOUND` - Campaign ID doesn't exist
- `MISSING_REQUIRED_FIELD` - Required field not provided

---

## Testing

Run the test script:

```bash
node test-post-management.js
```

Or test manually with curl/Postman using the examples above.

---

## Next Steps

1. **Frontend Integration**: Build UI for post editing and management
2. **Batch Operations**: Edit/delete multiple posts at once
3. **Version History**: Track post edit history
4. **Approval Workflow**: Add approval status before publishing
5. **Schedule Changes**: Allow rescheduling posts to different dates
