import {
  isClerkConfigured,
  isMollieConfigured,
  isSupabaseConfigured,
  isSupabaseServiceConfigured,
} from "@/lib/config";

export function GET() {
  return Response.json({
    clerk: isClerkConfigured(),
    mollie: isMollieConfigured(),
    supabasePublic: isSupabaseConfigured(),
    supabaseService: isSupabaseServiceConfigured(),
  });
}
