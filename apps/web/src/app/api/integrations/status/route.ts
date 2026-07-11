import {
  isClerkConfigured,
  isStripeConfigured,
  isSupabaseConfigured,
  isSupabaseServiceConfigured,
} from "@/lib/config";

export function GET() {
  return Response.json({
    clerk: isClerkConfigured(),
    stripe: isStripeConfigured(),
    supabasePublic: isSupabaseConfigured(),
    supabaseService: isSupabaseServiceConfigured(),
  });
}
