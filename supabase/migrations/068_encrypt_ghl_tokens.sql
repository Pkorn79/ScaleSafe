-- 068_encrypt_ghl_tokens.sql
-- Add encrypted GHL OAuth token columns. Existing plaintext columns stay for backward-compatible reads during transition.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS ghl_access_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS ghl_refresh_token_encrypted TEXT;

NOTIFY pgrst, 'reload schema';
