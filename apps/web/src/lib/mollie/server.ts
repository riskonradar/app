import createMollieClient from "@mollie/api-client";

import { getRequiredEnv } from "@/lib/config";

let mollieClient: ReturnType<typeof createMollieClient> | null = null;

export function getMollieClient() {
  if (!mollieClient) {
    mollieClient = createMollieClient({
      apiKey: getRequiredEnv("MOLLIE_API_KEY"),
    });
  }

  return mollieClient;
}
