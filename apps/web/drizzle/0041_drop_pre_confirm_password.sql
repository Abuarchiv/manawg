-- A password stored on an unconfirmed account was chosen by whoever registered the address first,
-- not necessarily its owner. When the address is confirmed, that password is dropped and the
-- account is flagged so the confirming user chooses their own; setting a password clears the flag.
-- Supabase Auth owns auth.users; databases without that schema skip this migration.
DO $migration$
BEGIN
	IF to_regclass('auth.users') IS NULL THEN
		RETURN;
	END IF;

	CREATE OR REPLACE FUNCTION public.manawg_drop_pre_confirm_password()
	RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = ''
	AS $fn$
	DECLARE
		pending boolean;
	BEGIN
		IF coalesce(NEW.encrypted_password, '') <> ''
			AND NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password THEN
			pending := false;
		ELSIF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL
			AND coalesce(OLD.encrypted_password, '') <> ''
			AND OLD.xmin <> pg_current_xact_id()::xid THEN
			-- A row written by this very transaction is an account created confirmed (admin API).
			NEW.encrypted_password := '';
			pending := true;
		ELSIF coalesce(NEW.encrypted_password, '') = ''
			AND coalesce(OLD.raw_app_meta_data ->> 'password_pending', '') = 'true' THEN
			-- Later writes of a stale in-memory copy must not drop the flag.
			pending := true;
		ELSE
			RETURN NEW;
		END IF;
		NEW.raw_app_meta_data := CASE WHEN pending
			THEN coalesce(NEW.raw_app_meta_data, '{}'::jsonb) || '{"password_pending": true}'::jsonb
			ELSE coalesce(NEW.raw_app_meta_data, '{}'::jsonb) - 'password_pending' END;
		RETURN NEW;
	END;
	$fn$;

	REVOKE ALL ON FUNCTION public.manawg_drop_pre_confirm_password() FROM PUBLIC;

	DROP TRIGGER IF EXISTS manawg_drop_pre_confirm_password ON auth.users;
	CREATE TRIGGER manawg_drop_pre_confirm_password
	BEFORE UPDATE OF email_confirmed_at, encrypted_password, raw_app_meta_data ON auth.users
	FOR EACH ROW EXECUTE FUNCTION public.manawg_drop_pre_confirm_password();
END
$migration$;
