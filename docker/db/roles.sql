-- Runs once when the database volume is created: Auth and Storage log in with the database password.
\set pgpass `echo "$POSTGRES_PASSWORD"`

ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_storage_admin WITH PASSWORD :'pgpass';
