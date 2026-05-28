-- Migration: Add regeneration token system tables
-- Adds per-campaign token ledger and transaction history

CREATE TABLE IF NOT EXISTS social.campaign_token_ledgers (
  id          TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  campaign_id TEXT        NOT NULL,
  balance     INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT campaign_token_ledgers_pkey PRIMARY KEY (id),
  CONSTRAINT campaign_token_ledgers_campaign_id_key UNIQUE (campaign_id),
  CONSTRAINT campaign_token_ledgers_balance_non_negative CHECK (balance >= 0),
  CONSTRAINT campaign_token_ledgers_balance_cap CHECK (balance <= 10)
);

CREATE TABLE IF NOT EXISTS social.campaign_token_transactions (
  id            TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  campaign_id   TEXT        NOT NULL,
  ledger_id     TEXT        NOT NULL,
  type          TEXT        NOT NULL,
  amount        INTEGER     NOT NULL,
  balance_after INTEGER     NOT NULL,
  description   TEXT        NOT NULL,
  post_id       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT campaign_token_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT campaign_token_transactions_ledger_fk
    FOREIGN KEY (ledger_id)
    REFERENCES social.campaign_token_ledgers(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_token_transactions_campaign_created
  ON social.campaign_token_transactions (campaign_id, created_at DESC);
