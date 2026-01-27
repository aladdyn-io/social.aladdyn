-- ============================================================================
-- Migration: Run all migrations in order
-- Usage: psql -d your_database < run_all_migrations.sql
-- ============================================================================

\echo '============================================================================'
\echo 'Running all database migrations for Social Scene'
\echo '============================================================================'
\echo ''

\echo '→ Creating campaigns table...'
\i 001_create_campaigns_table.sql
\echo '✓ campaigns table created'
\echo ''

\echo '→ Creating posts table...'
\i 002_create_posts_table.sql
\echo '✓ posts table created'
\echo ''

\echo '→ Creating social_accounts table...'
\i 003_create_social_accounts_table.sql
\echo '✓ social_accounts table created'
\echo ''

\echo '→ Creating scheduled_posts table...'
\i 004_create_scheduled_posts_table.sql
\echo '✓ scheduled_posts table created'
\echo ''

\echo '============================================================================'
\echo '✅ All migrations completed successfully!'
\echo '============================================================================'
\echo ''
\echo 'Tables created:'
\echo '  - campaigns'
\echo '  - posts'
\echo '  - social_accounts'
\echo '  - scheduled_posts'
\echo ''
\echo 'Next steps:'
\echo '  1. Verify tables: \dt'
\echo '  2. Check sample data: SELECT * FROM campaigns;'
\echo '  3. Run application: npm run dev'
\echo ''
