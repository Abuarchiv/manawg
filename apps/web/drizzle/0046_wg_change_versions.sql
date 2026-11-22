CREATE TABLE "wg_change_versions" (
	"wg_id" uuid PRIMARY KEY NOT NULL,
	"data_version" bigint DEFAULT 0 NOT NULL,
	"members_version" bigint DEFAULT 0 NOT NULL,
	"chat_version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wg_change_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "wg_change_versions" FROM anon, authenticated;--> statement-breakpoint
-- Sets one of a WG's versions to the writing transaction's id. The triggers are deferred to
-- commit, so the version row is locked only for the moment the transaction commits, after every
-- other lock it takes, instead of from its first write on. Many rows in one transaction (an
-- import, a cascade) write the row once: later rows find the value already set. TG_ARGV[0] is the
-- version ('data', 'members' or 'chat'); for rows without a wg_id, TG_ARGV[1] names the parent
-- table and TG_ARGV[2] the column that holds its id. A WG deleted in the same transaction (its
-- children cascading) gets no version row.
CREATE OR REPLACE FUNCTION public.manawg_bump_wg_change_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  changed jsonb;
  target uuid;
  version_column text := TG_ARGV[0] || '_version';
BEGIN
  IF TG_ARGV[0] NOT IN ('data', 'members', 'chat') THEN
    RAISE EXCEPTION 'unknown WG change version %', TG_ARGV[0];
  END IF;
  IF TG_OP = 'DELETE' THEN
    changed := to_jsonb(OLD);
  ELSE
    changed := to_jsonb(NEW);
  END IF;
  IF TG_NARGS = 1 THEN
    target := (changed->>'wg_id')::uuid;
  ELSE
    EXECUTE format('SELECT wg_id FROM public.%I WHERE id = $1', TG_ARGV[1])
      INTO target
      USING (changed->>TG_ARGV[2])::uuid;
  END IF;
  IF target IS NULL OR NOT EXISTS (SELECT 1 FROM public.wgs WHERE id = target) THEN
    RETURN NULL;
  END IF;
  EXECUTE format(
    'INSERT INTO public.wg_change_versions AS v (wg_id, %1$I) VALUES ($1, $2)
     ON CONFLICT (wg_id) DO UPDATE SET %1$I = EXCLUDED.%1$I WHERE v.%1$I <> EXCLUDED.%1$I',
    version_column
  ) USING target, txid_current();
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.manawg_bump_wg_change_version() FROM PUBLIC;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER wg_members_change_version AFTER INSERT OR UPDATE OR DELETE ON public.wg_members
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.manawg_bump_wg_change_version('members');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER expenses_change_version AFTER INSERT OR UPDATE OR DELETE ON public.expenses
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.manawg_bump_wg_change_version('data');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER expense_splits_change_version AFTER INSERT OR UPDATE OR DELETE ON public.expense_splits
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.manawg_bump_wg_change_version('data', 'expenses', 'expense_id');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER expense_payments_change_version AFTER INSERT OR UPDATE OR DELETE ON public.expense_payments
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.manawg_bump_wg_change_version('data');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER recurring_expenses_change_version AFTER INSERT OR UPDATE OR DELETE ON public.recurring_expenses
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.manawg_bump_wg_change_version('data');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER expense_reminders_change_version AFTER INSERT OR UPDATE OR DELETE ON public.expense_reminders
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.manawg_bump_wg_change_version('data');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER announcements_change_version AFTER INSERT OR UPDATE OR DELETE ON public.announcements
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.manawg_bump_wg_change_version('data');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER announcement_reactions_change_version AFTER INSERT OR UPDATE OR DELETE ON public.announcement_reactions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.manawg_bump_wg_change_version('data', 'announcements', 'announcement_id');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER announcement_comments_change_version AFTER INSERT OR UPDATE OR DELETE ON public.announcement_comments
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.manawg_bump_wg_change_version('data', 'announcements', 'announcement_id');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER wg_events_change_version AFTER INSERT OR UPDATE OR DELETE ON public.wg_events
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.manawg_bump_wg_change_version('data');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER shopping_items_change_version AFTER INSERT OR UPDATE OR DELETE ON public.shopping_items
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.manawg_bump_wg_change_version('data');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER chores_change_version AFTER INSERT OR UPDATE OR DELETE ON public.chores
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.manawg_bump_wg_change_version('data');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER chore_completions_change_version AFTER INSERT OR UPDATE OR DELETE ON public.chore_completions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.manawg_bump_wg_change_version('data', 'chores', 'chore_id');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER member_absences_change_version AFTER INSERT OR UPDATE OR DELETE ON public.member_absences
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.manawg_bump_wg_change_version('data');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER wg_inventory_items_change_version AFTER INSERT OR UPDATE OR DELETE ON public.wg_inventory_items
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.manawg_bump_wg_change_version('data');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER wg_inventory_log_change_version AFTER INSERT OR UPDATE OR DELETE ON public.wg_inventory_log
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.manawg_bump_wg_change_version('data', 'wg_inventory_items', 'item_id');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER wg_chat_messages_change_version AFTER INSERT OR UPDATE OR DELETE ON public.wg_chat_messages
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.manawg_bump_wg_change_version('chat');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER wg_chat_reads_change_version AFTER INSERT OR UPDATE OR DELETE ON public.wg_chat_reads
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.manawg_bump_wg_change_version('chat');--> statement-breakpoint
-- The activity feed also lists audit-only events (settings, invitations); chat messages have
-- their own poll and must not make every list page refetch.
CREATE CONSTRAINT TRIGGER audit_events_change_version AFTER INSERT ON public.audit_events
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.entity_type <> 'chat_message')
EXECUTE FUNCTION public.manawg_bump_wg_change_version('data');--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.manawg_drop_wg_change_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.wg_change_versions WHERE wg_id = OLD.id;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.manawg_drop_wg_change_version() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER wgs_drop_change_version AFTER DELETE ON public.wgs
FOR EACH ROW EXECUTE FUNCTION public.manawg_drop_wg_change_version();
