/**
 * Database Module
 * 
 * Responsibility: Read campaign data from PostgreSQL
 * NO AI - Pure database query
 * 
 * WHY: Centralized database access with proper connection pooling
 */

import { Pool } from 'pg';
import { DatabaseInput } from '../types';

/**
 * PostgreSQL connection pool
 * WHY: Connection pooling for better performance
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Alternative: individual connection params
  // host: process.env.DB_HOST,
  // port: parseInt(process.env.DB_PORT || '5432'),
  // user: process.env.DB_USER,
  // password: process.env.DB_PASSWORD,
  // database: process.env.DB_NAME,
  max: 20, // Maximum pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

/**
 * Fetches campaign data from database
 * 
 * Query structure assumes table: campaigns
 * Columns match DatabaseInput interface
 * 
 * TODO: Adjust query based on actual schema
 * WHY: Schema may differ from assumptions
 * 
 * @param campaignId - Campaign ID to fetch
 * @returns Campaign data
 * @throws Error if campaign not found or query fails
 */
export async function getCampaignFromDB(
  campaignId: string
): Promise<DatabaseInput> {
  console.log(`[Database] Fetching campaign: ${campaignId}`);

  try {
    // ========================================================================
    // QUERY DATABASE
    // TODO: Adjust based on actual schema
    // ========================================================================
    
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

    // ========================================================================
    // MAP TO DatabaseInput
    // WHY: Type-safe data contract
    // ========================================================================
    
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
      services: row.services, // Assuming stored as array type
      geography: row.geography,
    };
  } catch (error) {
    console.error('[Database] ✗ Query failed:', error);
    throw new Error(
      `Database query failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Saves generated posts back to database
 * 
 * TODO: Implement based on actual schema
 * WHY: Posts need to be persisted for scheduling
 */
export async function savePostsToDB(
  campaignId: string,
  posts: any[]
): Promise<void> {
  console.log(`[Database] Saving ${posts.length} posts for campaign ${campaignId}...`);

  // TODO: Implement batch insert
  // Table structure should include:
  // - post_id, campaign_id, scheduled_date, caption, image_url, hashtags, etc.

  throw new Error('savePostsToDB not implemented yet');
}

/**
 * Closes database connection pool
 * WHY: Graceful shutdown
 */
export async function closeDatabase(): Promise<void> {
  await pool.end();
  console.log('[Database] Connection pool closed');
}
