-- The app connects as manawg_app: row access only, no DDL, no ownership. The role and its
-- password are created per project (docs/database-recovery.md); where it is missing this is a no-op.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'manawg_app') THEN
		RETURN;
	END IF;
	GRANT USAGE ON SCHEMA public TO manawg_app;
	GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO manawg_app;
	GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO manawg_app;
	ALTER DEFAULT PRIVILEGES IN SCHEMA public
		GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO manawg_app;
	ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO manawg_app;
END $$;
