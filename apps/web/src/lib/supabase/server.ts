import { createClient } from "@supabase/supabase-js";

import { getRequiredEnv } from "@/lib/config";

let anonClient: ReturnType<typeof createClient> | null = null;
let serviceClient: ReturnType<typeof createClient> | null = null;

export function getSupabaseAnonClient() {
  if (!anonClient) {
    anonClient = createClient(
      getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
      getRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    );
  }

  return anonClient;
}

export function getSupabaseServiceClient() {
  if (!serviceClient) {
    serviceClient = createClient(
      getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
      getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
  }

  return serviceClient;
}
