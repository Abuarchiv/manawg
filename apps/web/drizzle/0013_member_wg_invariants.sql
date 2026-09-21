-- Enforce that every member reference on a WG-scoped row belongs to that same WG.
-- Application validation remains useful for friendly errors, but this trigger is
-- the database boundary for trusted jobs, imports, and future write paths.

CREATE OR REPLACE FUNCTION public.manawg_assert_member_belongs_to_wg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  member_id uuid;
  member_column text;
  row_wg_id uuid;
BEGIN
  row_wg_id := NEW.wg_id;
  FOREACH member_column IN ARRAY TG_ARGV LOOP
    member_id := NULLIF(to_jsonb(NEW)->>member_column, '')::uuid;
    IF member_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.wg_members member
      WHERE member.id = member_id
        AND member.wg_id = row_wg_id
    ) THEN
      RAISE EXCEPTION 'member % does not belong to WG %', member_id, row_wg_id
        USING ERRCODE = '23503', CONSTRAINT = 'member_wg_same_tenant';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.manawg_assert_member_belongs_to_wg() FROM PUBLIC;

CREATE TRIGGER expenses_member_wg_same_tenant
BEFORE INSERT OR UPDATE ON public.expenses
FOR EACH ROW EXECUTE FUNCTION public.manawg_assert_member_belongs_to_wg('paid_by_member_id');

CREATE TRIGGER expense_imports_member_wg_same_tenant
BEFORE INSERT OR UPDATE ON public.expense_imports
FOR EACH ROW EXECUTE FUNCTION public.manawg_assert_member_belongs_to_wg('imported_by_member_id');

CREATE TRIGGER expense_payments_member_wg_same_tenant
BEFORE INSERT OR UPDATE ON public.expense_payments
FOR EACH ROW EXECUTE FUNCTION public.manawg_assert_member_belongs_to_wg('from_member_id', 'to_member_id');

CREATE TRIGGER shopping_items_member_wg_same_tenant
BEFORE INSERT OR UPDATE ON public.shopping_items
FOR EACH ROW EXECUTE FUNCTION public.manawg_assert_member_belongs_to_wg('added_by_member_id', 'bought_by_member_id');

CREATE TRIGGER announcements_member_wg_same_tenant
BEFORE INSERT OR UPDATE ON public.announcements
FOR EACH ROW EXECUTE FUNCTION public.manawg_assert_member_belongs_to_wg('author_member_id', 'resolved_by_member_id');

CREATE TRIGGER chores_member_wg_same_tenant
BEFORE INSERT OR UPDATE ON public.chores
FOR EACH ROW EXECUTE FUNCTION public.manawg_assert_member_belongs_to_wg('assigned_member_id');

CREATE TRIGGER member_absences_member_wg_same_tenant
BEFORE INSERT OR UPDATE ON public.member_absences
FOR EACH ROW EXECUTE FUNCTION public.manawg_assert_member_belongs_to_wg('member_id');

CREATE TRIGGER recurring_expenses_member_wg_same_tenant
BEFORE INSERT OR UPDATE ON public.recurring_expenses
FOR EACH ROW EXECUTE FUNCTION public.manawg_assert_member_belongs_to_wg('created_by_member_id', 'paid_by_member_id');

CREATE TRIGGER wg_events_member_wg_same_tenant
BEFORE INSERT OR UPDATE ON public.wg_events
FOR EACH ROW EXECUTE FUNCTION public.manawg_assert_member_belongs_to_wg('created_by_member_id');

CREATE TRIGGER calendar_subscriptions_member_wg_same_tenant
BEFORE INSERT OR UPDATE ON public.calendar_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.manawg_assert_member_belongs_to_wg('member_id');

CREATE TRIGGER expense_reminders_member_wg_same_tenant
BEFORE INSERT OR UPDATE ON public.expense_reminders
FOR EACH ROW EXECUTE FUNCTION public.manawg_assert_member_belongs_to_wg(
  'debtor_member_id', 'creditor_member_id', 'sent_by_member_id'
);

CREATE TRIGGER audit_events_member_wg_same_tenant
BEFORE INSERT OR UPDATE ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION public.manawg_assert_member_belongs_to_wg('member_id');

CREATE TRIGGER wg_chat_messages_member_wg_same_tenant
BEFORE INSERT OR UPDATE ON public.wg_chat_messages
FOR EACH ROW EXECUTE FUNCTION public.manawg_assert_member_belongs_to_wg('sender_member_id');

CREATE TRIGGER wg_chat_reads_member_wg_same_tenant
BEFORE INSERT OR UPDATE ON public.wg_chat_reads
FOR EACH ROW EXECUTE FUNCTION public.manawg_assert_member_belongs_to_wg('member_id');

-- Tables whose rows inherit the WG through a parent do not carry wg_id of
-- their own. Check those relationships at their parent boundary as well.
CREATE OR REPLACE FUNCTION public.manawg_assert_expense_split_member_wg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.expenses expense
    JOIN public.wg_members member
      ON member.id = NEW.debtor_member_id
     AND member.wg_id = expense.wg_id
    WHERE expense.id = NEW.expense_id
  ) THEN
    RAISE EXCEPTION 'expense split member is outside the expense WG'
      USING ERRCODE = '23503', CONSTRAINT = 'expense_split_member_wg_same_tenant';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.manawg_assert_expense_split_member_wg() FROM PUBLIC;
CREATE TRIGGER expense_splits_member_wg_same_tenant
BEFORE INSERT OR UPDATE ON public.expense_splits
FOR EACH ROW EXECUTE FUNCTION public.manawg_assert_expense_split_member_wg();

CREATE OR REPLACE FUNCTION public.manawg_assert_chore_completion_member_wg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.chores chore
    JOIN public.wg_members member
      ON member.id = NEW.completed_by_member_id
     AND member.wg_id = chore.wg_id
    WHERE chore.id = NEW.chore_id
  ) THEN
    RAISE EXCEPTION 'chore completion member is outside the chore WG'
      USING ERRCODE = '23503', CONSTRAINT = 'chore_completion_member_wg_same_tenant';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.manawg_assert_chore_completion_member_wg() FROM PUBLIC;
CREATE TRIGGER chore_completions_member_wg_same_tenant
BEFORE INSERT OR UPDATE ON public.chore_completions
FOR EACH ROW EXECUTE FUNCTION public.manawg_assert_chore_completion_member_wg();

CREATE OR REPLACE FUNCTION public.manawg_assert_announcement_member_wg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.announcements announcement
    JOIN public.wg_members member
      ON member.id = NEW.member_id
     AND member.wg_id = announcement.wg_id
    WHERE announcement.id = NEW.announcement_id
  ) THEN
    RAISE EXCEPTION 'announcement member is outside the announcement WG'
      USING ERRCODE = '23503', CONSTRAINT = 'announcement_member_wg_same_tenant';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.manawg_assert_announcement_member_wg() FROM PUBLIC;
CREATE TRIGGER announcement_reactions_member_wg_same_tenant
BEFORE INSERT OR UPDATE ON public.announcement_reactions
FOR EACH ROW EXECUTE FUNCTION public.manawg_assert_announcement_member_wg();
CREATE TRIGGER announcement_comments_member_wg_same_tenant
BEFORE INSERT OR UPDATE ON public.announcement_comments
FOR EACH ROW EXECUTE FUNCTION public.manawg_assert_announcement_member_wg();

CREATE OR REPLACE FUNCTION public.manawg_assert_inventory_log_member_wg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.member_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.wg_inventory_items item
    JOIN public.wg_members member
      ON member.id = NEW.member_id
     AND member.wg_id = item.wg_id
    WHERE item.id = NEW.item_id
  ) THEN
    RAISE EXCEPTION 'inventory log member is outside the inventory WG'
      USING ERRCODE = '23503', CONSTRAINT = 'inventory_log_member_wg_same_tenant';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.manawg_assert_inventory_log_member_wg() FROM PUBLIC;
CREATE TRIGGER wg_inventory_log_member_wg_same_tenant
BEFORE INSERT OR UPDATE ON public.wg_inventory_log
FOR EACH ROW EXECUTE FUNCTION public.manawg_assert_inventory_log_member_wg();

CREATE OR REPLACE FUNCTION public.manawg_assert_chat_member_wg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.wg_chat_messages message
    JOIN public.wg_members member
      ON member.id = NEW.member_id
     AND member.wg_id = message.wg_id
    WHERE message.id = NEW.message_id
  ) THEN
    RAISE EXCEPTION 'chat member is outside the message WG'
      USING ERRCODE = '23503', CONSTRAINT = 'chat_member_wg_same_tenant';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.manawg_assert_chat_member_wg() FROM PUBLIC;
CREATE TRIGGER wg_chat_reactions_member_wg_same_tenant
BEFORE INSERT OR UPDATE ON public.wg_chat_reactions
FOR EACH ROW EXECUTE FUNCTION public.manawg_assert_chat_member_wg();

CREATE OR REPLACE FUNCTION public.manawg_assert_chat_mention_wg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.wg_chat_messages message
    JOIN public.wg_members member
      ON member.id = NEW.mentioned_member_id
     AND member.wg_id = message.wg_id
    WHERE message.id = NEW.message_id
  ) THEN
    RAISE EXCEPTION 'chat mention member is outside the message WG'
      USING ERRCODE = '23503', CONSTRAINT = 'chat_mention_member_wg_same_tenant';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.manawg_assert_chat_mention_wg() FROM PUBLIC;
CREATE TRIGGER wg_chat_mentions_member_wg_same_tenant
BEFORE INSERT OR UPDATE ON public.wg_chat_mentions
FOR EACH ROW EXECUTE FUNCTION public.manawg_assert_chat_mention_wg();
--> statement-breakpoint
