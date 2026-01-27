/**
 * Database Module
 * 
 * Responsibility: Read/Write campaign and post data to PostgreSQL
 * NO AI - Pure database operations
 * 
 * WHY: Centralized database access with proper connection pooling
 */

import { Pool } from 'pg';
import { DatabaseInput } from '../types';
import { PostItem } from '../types/content';

/**
 * PostgreSQL connection pool
 * WHY: Connection pooling for better performance
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// ============================================================================
// CAMPAIGN FUNCTIONS
// ============================================================================

/**
 * Fetches campaign data from database
 * 
 * @param campaignId - Campaign UUID to fetch
 * @returns Campaign data
 * @throws Error if campaign not found or query fails
 */
export async function getCampaignFromDB(
  campaignId: string
): Promise<DatabaseInput> {
  console.log(`[Database] Fetching campaign: ${campaignId}`);

  try {
    const query = `
      SELECT 
        campaign_id,
        industry,
        total_days,
        frequency_per_week,
        festival_enabled,
        logo_url,
        font_style,
        accent_color,
        base_color,
        services,
        geography
      FROM campaigns
      WHERE campaign_id = $1
    `;

    const result = await pool.query(query, [campaignId]);

    if (result.rows.length === 0) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }

    const row = result.rows[0];

    console.log('[Database] ✓ Campaign fetched successfully');

    return {
      campaign_id: row.campaign_id,
      industry: row.industry,
      total_days: row.total_days,
      frequency_per_week: row.frequency_per_week,
      festival_enabled: row.festival_enabled,
      logo_url: row.logo_url,
      font_style: row.font_style,
      accent_color: row.accent_color,
      base_color: row.base_color,
      services: row.services,
      geography: row.geography,
    };
  } catch (error) {
    console.error('[Database] ✗ Query failed:', error);
    throw new Error(
      `Database query failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ============================================================================
// POST FUNCTIONS
// ============================================================================

/**
 * Saves generated posts to database
 * 
 * @param campaignId - Campaign UUID
 * @param posts - Array of generated posts
 * @returns Array of saved post IDs
 */
export async function savePostsToDB(
  campaignId: string,
  posts: PostItem[]
): Promise<string[]> {
  console.log(`[Database] Saving ${posts.length} posts for campaign ${campaignId}...`);

  const client = await pool.connect();
  const savedIds: string[] = [];

  try {
    await client.query('BEGIN');

    for (const post of posts) {
      const query = `
        INSERT INTO posts (
          campaign_id,
          scheduled_date,
          caption,
          hashtags,
          call_to_action,
          image_url,
          image_prompt,
          image_model,
          content_pillar,
          topic,
          content_type,
          is_festival,
          festival_name,
          status
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
        )
        RETURNING post_id
      `;

      const values = [
        campaignId,
        post.scheduledDate,
        post.caption,
        post.hashtags,
        post.callToAction || null,
        post.imageUrl,
        post.metadata.imagePrompt,
        post.metadata.imageModel,
        post.metadata.contentPillar || null,
        null, // topic - not available in PostItem
        'image',
        post.metadata.festival ? true : false,
        post.metadata.festival || null,
        'draft',
      ];

      const result = await client.query(query, values);
      savedIds.push(result.rows[0].post_id);
    }

    await client.query('COMMIT');
    console.log(`[Database] ✓ Saved ${savedIds.length} posts successfully`);

    return savedIds;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Database] ✗ Save posts failed:', error);
    throw new Error(
      `Failed to save posts: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    client.release();
  }
}

/**
 * Fetches all posts for a campaign
 * 
 * @param campaignId - Campaign UUID
 * @returns Array of posts
 */
export async function getPostsByCampaign(
  campaignId: string
): Promise<any[]> {
  console.log(`[Database] Fetching posts for campaign: ${campaignId}`);

  try {
    const query = `
      SELECT 
        post_id,
        campaign_id,
        scheduled_date,
        scheduled_time,
        caption,
        hashtags,
        call_to_action,
        image_url,
        image_prompt,
        image_model,
        content_pillar,
        topic,
        content_type,
        is_festival,
        festival_name,
        status,
        created_at,
        updated_at
      FROM posts
      WHERE campaign_id = $1
      ORDER BY scheduled_date ASC
    `;

    const result = await pool.query(query, [campaignId]);

    console.log(`[Database] ✓ Found ${result.rows.length} posts`);

    return result.rows;
  } catch (error) {
    console.error('[Database] ✗ Query failed:', error);
    throw new Error(
      `Failed to fetch posts: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Fetches posts for a specific date
 * 
 * @param campaignId - Campaign UUID
 * @param date - Date in YYYY-MM-DD format
 * @returns Array of posts for that date
 */
export async function getPostsByDate(
  campaignId: string,
  date: string
): Promise<any[]> {
  console.log(`[Database] Fetching posts for ${date} in campaign ${campaignId}`);

  try {
    const query = `
      SELECT 
        post_id,
        campaign_id,
        scheduled_date,
        scheduled_time,
        caption,
        hashtags,
        call_to_action,
        image_url,
        image_prompt,
        image_model,
        content_pillar,
        topic,
        content_type,
        is_festival,
        festival_name,
        status,
        created_at,
        updated_at
      FROM posts
      WHERE campaign_id = $1 AND scheduled_date = $2
      ORDER BY created_at ASC
    `;

    const result = await pool.query(query, [campaignId, date]);

    console.log(`[Database] ✓ Found ${result.rows.length} posts for ${date}`);

    return result.rows;
  } catch (error) {
    console.error('[Database] ✗ Query failed:', error);
    throw new Error(
      `Failed to fetch posts by date: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Updates a single post
 * 
 * @param postId - Post UUID
 * @param updates - Fields to update
 * @returns Updated post data
 */
export async function updatePost(
  postId: string,
  updates: {
    caption?: string;
    hashtags?: string[];
    image_url?: string;
    image_prompt?: string;
    status?: string;
  }
): Promise<any> {
  console.log(`[Database] Updating post: ${postId}`);

  try {
    // Build dynamic UPDATE query
    const fields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (updates.caption !== undefined) {
      fields.push(`caption = $${paramCount++}`);
      values.push(updates.caption);
    }
    if (updates.hashtags !== undefined) {
      fields.push(`hashtags = $${paramCount++}`);
      values.push(updates.hashtags);
    }
    if (updates.image_url !== undefined) {
      fields.push(`image_url = $${paramCount++}`);
      values.push(updates.image_url);
    }
    if (updates.image_prompt !== undefined) {
      fields.push(`image_prompt = $${paramCount++}`);
      values.push(updates.image_prompt);
    }
    if (updates.status !== undefined) {
      fields.push(`status = $${paramCount++}`);
      values.push(updates.status);
    }

    if (fields.length === 0) {
      throw new Error('No fields to update');
    }

    values.push(postId);

    const query = `
      UPDATE posts
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE post_id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      throw new Error(`Post not found: ${postId}`);
    }

    console.log(`[Database] ✓ Post updated successfully`);

    return result.rows[0];
  } catch (error) {
    console.error('[Database] ✗ Update failed:', error);
    throw new Error(
      `Failed to update post: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Deletes a post
 * 
 * @param postId - Post UUID
 */
export async function deletePost(postId: string): Promise<void> {
  console.log(`[Database] Deleting post: ${postId}`);

  try {
    const query = `
      DELETE FROM posts
      WHERE post_id = $1
    `;

    const result = await pool.query(query, [postId]);

    if (result.rowCount === 0) {
      throw new Error(`Post not found: ${postId}`);
    }

    console.log(`[Database] ✓ Post deleted successfully`);
  } catch (error) {
    console.error('[Database] ✗ Delete failed:', error);
    throw new Error(
      `Failed to delete post: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Closes database connection pool
 * WHY: Graceful shutdown
 */
export async function closeDatabase(): Promise<void> {
  await pool.end();
  console.log('[Database] Connection pool closed');
}
