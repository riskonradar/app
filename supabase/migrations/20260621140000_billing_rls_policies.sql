-- Add RLS policies for billing tables to ensure service role access
-- Even though service role bypasses RLS, explicit policies ensure clarity

DROP POLICY IF EXISTS "service role all billing_payments"
  ON app.billing_payments;

CREATE POLICY "service role all billing_payments"
  ON app.billing_payments FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "service role all billing_customers"
  ON app.billing_customers;

CREATE POLICY "service role all billing_customers"
  ON app.billing_customers FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "service role all user_accounts"
  ON app.user_accounts;

CREATE POLICY "service role all user_accounts"
  ON app.user_accounts FOR ALL
  USING (true)
  WITH CHECK (true);
