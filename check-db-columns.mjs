import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const result = await pool.query(
  `SELECT column_name 
   FROM information_schema.columns 
   WHERE table_schema = 'social' 
     AND table_name = 'social_posts' 
   ORDER BY ordinal_position`
);

console.log('Columns in social.social_posts:');
result.rows.forEach(r => console.log(' -', r.column_name));

const videoColumns = result.rows.filter(r => 
  ['video_prompt', 'media_type', 'is_fallback'].includes(r.column_name)
);
console.log('\nVideo columns present:', videoColumns.map(r => r.column_name).join(', ') || 'NONE');

await pool.end();
