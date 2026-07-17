-- The product now uses taxonomy-aware component/failure-mode search. Keep the
-- old aviation-only function out of the callable API instead of leaving a
-- second, contradictory result path behind.

DROP FUNCTION IF EXISTS public.get_turbofan_fmea(integer);
