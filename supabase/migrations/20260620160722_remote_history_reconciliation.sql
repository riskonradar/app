-- Reconciles a remote-only Supabase migration version.
--
-- This version exists in the linked Supabase project's migration history, but
-- the original local migration file is not present in git history. Keep this
-- no-op file so `supabase db push` can compare local and remote migration
-- versions without failing on a remote-only entry.

select 1;
