-- Preview applies migrations as a dedicated CI role, so tables it creates are not reachable
-- by the runtime role. Production migrates as the runtime role itself; there this is a no-op.
DO $$
DECLARE
	object_name text;
BEGIN
	IF current_user = 'postgres' OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
		RETURN;
	END IF;
	FOR object_name IN
		SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND pg_get_userbyid(c.relowner) = current_user
	LOOP
		EXECUTE format(
			'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I TO postgres',
			object_name
		);
	END LOOP;
	FOR object_name IN
		SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public' AND c.relkind = 'S' AND pg_get_userbyid(c.relowner) = current_user
	LOOP
		EXECUTE format('GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.%I TO postgres', object_name);
	END LOOP;
	ALTER DEFAULT PRIVILEGES IN SCHEMA public
		GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO postgres;
	ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO postgres;
END $$;
