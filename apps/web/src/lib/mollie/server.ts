import createMollieClient from "@mollie/api-client";

import { getMollieApiKey } from "@/lib/config";

let mollieClient: ReturnType<typeof createMollieClient> | null = null;

export function getMollieClient() {
  if (!mollieClient) {
    // Cloudflare Workers doesn't set process.release; Mollie's client checks it on init.
    if (typeof process !== "undefined" && !process.release) {
      (process as NodeJS.Process).release = { name: "node" };
    }

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
