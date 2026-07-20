-- Reconciles a remote-only Supabase migration version.
--
-- This version exists in the linked project's migration history, but its
-- original SQL is not present in git. The corresponding schema state was
-- verified before adding this no-op history placeholder.

select 1;
