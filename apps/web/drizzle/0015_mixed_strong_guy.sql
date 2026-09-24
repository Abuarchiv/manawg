CREATE TABLE "account_deletions" (
	"auth_user_id" uuid PRIMARY KEY NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "account_deletions_pending_attempt_idx" ON "account_deletions" USING btree ("last_attempt_at","requested_at","auth_user_id") WHERE "account_deletions"."completed_at" IS NULL;
--> statement-breakpoint
ALTER TABLE public.account_deletions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE public.account_deletions FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE role_name text;
BEGIN
	FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
			EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.account_deletions FROM %I', role_name);
		END IF;
	END LOOP;
END $$;
