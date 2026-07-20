-- Deterministic local reset seed.
--
-- Taxonomy and subscription reference rows are installed by versioned
-- migrations. Do not create fake Clerk users, organizations, paper counts, or
-- classifier jobs here: Clerk identity is verified by the Next.js server and
-- pipeline/runtime truth must remain database-derived.
SELECT 1;
