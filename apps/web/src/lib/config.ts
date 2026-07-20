export function isClerkConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
  );
}

export function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export function isSupabaseServiceConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getStripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY || null;
}

export function getStripeWebhookSecret() {
  return process.env.STRIPE_WEBHOOK_SECRET || null;
}

export function isStripeConfigured() {
  return Boolean(getStripeSecretKey());
}

export function isStripeTaxEnabled() {
  return process.env.STRIPE_TAX_ENABLED?.trim().toLowerCase() === "true";
}

export function isStripeLiveMode() {
  const key = getStripeSecretKey();
  return Boolean(key && (key.startsWith("sk_live_") || key.startsWith("rk_live_")));
}

export function getStripeCustomerPortalConfigurationId() {
  return process.env.STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID || null;
}

export function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
