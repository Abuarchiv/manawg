-- Absence audit events were written under two entity types: 'absence' (create) and
-- 'member_absence' (delete, matching the table). Everything now uses 'member_absence'.
UPDATE "audit_events" SET "entity_type" = 'member_absence' WHERE "entity_type" = 'absence';
