-- 088_merchant_token_columns_nullable.sql
--
-- Root cause of the 2026-07-09 Marketplace install failure (INTERNAL_ERROR at
-- the final install step): merchantRepository.encryptTokenUpdates() writes
-- tokens to the *_encrypted columns and nulls the plaintext columns, but
-- migration 068 only ADDED the encrypted columns — it never dropped the
-- NOT NULL that 001 put on the plaintext ones. Every new-merchant insert since
-- the encryption change failed with 23502 (and token-refresh updates on
-- existing merchants are exposed to the same violation).
--
-- Plaintext token columns stay for legacy reads but are now nullable.

ALTER TABLE merchants
  ALTER COLUMN ghl_access_token DROP NOT NULL;

ALTER TABLE merchants
  ALTER COLUMN ghl_refresh_token DROP NOT NULL;
