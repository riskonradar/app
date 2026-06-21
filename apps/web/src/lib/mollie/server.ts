import { getMollieApiKey } from "@/lib/config";

const MOLLIE_API = "https://api.mollie.com/v2";

type MollieAmount = { currency: string; value: string };

type MolliePaymentResponse = {
  id: string;
  status: string;
  amount: MollieAmount;
  metadata: Record<string, unknown>;
  _links: { checkout?: { href: string } };
};

async function mollieRequest(path: string, options?: RequestInit): Promise<MolliePaymentResponse> {
  const apiKey = getMollieApiKey();
  if (!apiKey) throw new Error("Missing Mollie API key.");

  const response = await fetch(`${MOLLIE_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await response.json()) as any;
  if (!response.ok) {
    throw new Error(`Mollie ${response.status}: ${data?.detail ?? data?.message ?? response.statusText}`);
  }

  return data as MolliePaymentResponse;
}

export function getMollieClient() {
  return {
    payments: {
      create: (body: {
        amount: MollieAmount;
        description: string;
        redirectUrl: string;
        webhookUrl?: string;
        metadata?: Record<string, unknown>;
      }) => mollieRequest("/payments", { method: "POST", body: JSON.stringify(body) }),

      get: (id: string) => mollieRequest(`/payments/${id}`),
    },
  };
}
