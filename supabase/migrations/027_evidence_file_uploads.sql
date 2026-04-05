-- 027_evidence_file_uploads.sql — Phase S2: Evidence file upload support

-- Add Stripe terms file ID to offers_mirror
ALTER TABLE offers_mirror ADD COLUMN IF NOT EXISTS stripe_terms_file_id TEXT;

-- RPC function to append a session file ID to the array
CREATE OR REPLACE FUNCTION append_session_file_id(
  p_merchant_id UUID,
  p_offer_id UUID,
  p_customer_id TEXT,
  p_file_id TEXT
) RETURNS void AS $$
BEGIN
  UPDATE stripe_evidence_vault
  SET session_file_ids = array_append(session_file_ids, p_file_id),
      updated_at = NOW()
  WHERE merchant_id = p_merchant_id
    AND offer_id = p_offer_id
    AND stripe_customer_id = p_customer_id;
END;
$$ LANGUAGE plpgsql;
