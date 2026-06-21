import createMollieClient from "@mollie/api-client";

import { getMollieApiKey } from "@/lib/config";

let mollieClient: ReturnType<typeof createMollieClient> | null = null;

export function getMollieClient() {
  if (!mollieClient) {
    const apiKey = getMollieApiKey();
    if (!apiKey) {
      throw new Error("Missing Mollie API key.");
    }

    mollieClient = createMollieClient({
      apiKey,
    });
  }

  return mollieClient;
}
