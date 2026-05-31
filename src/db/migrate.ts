/**
 * Database Migration Runner
 * 
 * Runs SQL migrations to create database schema
 * Usage: npm run migrate
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runMigration(filename: string): Promise<void> {
  console.log(`\n→ Running migration: ${filename}...`);
  
  try {
    const sqlPath = join(__dirname, 'migrations', filename);
    const sql = readFileSync(sqlPath, 'utf-8');
    
    await pool.query(sql);
    
    console.log(`✓ ${filename} completed successfully`);
  } catch (error) {
    console.error(`✗ ${filename} failed:`, error);
    throw error;
  }
}

async function runAllMigrations(): Promise<void> {
  console.log('============================================================================');
  console.log('Running all database migrations for Social Scene');
  console.log('============================================================================');
  
  try {
    // Test connection
    await pool.query('SELECT NOW()');
    console.log('✓ Database connection successful\n');
    
    // Run migrations in order
    await runMigration('001_create_campaigns_table.sql');
    await runMigration('002_create_posts_table.sql');
    await runMigration('003_create_social_accounts_table.sql');
    await runMigration('004_create_scheduled_posts_table.sql');
    await runMigration('005_update_posts_for_prompt_based_generation.sql');
    await runMigration('006_create_strategies_table.sql');
    await runMigration('007_create_calendar_entries_table.sql');
    await runMigration('008_add_campaign_goal_and_fks.sql');
    await runMigration('009_add_video_fields.sql');
    
    console.log('\n============================================================================');
    console.log('✅ All migrations completed successfully!');
    console.log('============================================================================');
    console.log('\nTables created:');
    console.log('  - campaigns');
    console.log('  - posts');
    console.log('  - social_accounts');
    console.log('  - scheduled_posts');
    console.log('  - strategies (v2 - AI strategy persistence)');
    console.log('  - calendar_entries (v2 - content calendar)');
    console.log('\nUpdates:');
    console.log('  - posts: added detailed_image_prompt, nullable image_url');
    console.log('  - campaigns: added campaign_goal field');
    console.log('  - posts: added foreign keys to calendar_entries and strategies');
    console.log('  - social_posts: added video_prompt, media_type, is_fallback');
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migrations
runAllMigrations();
