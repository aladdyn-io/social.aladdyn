/**
 * Token Service — Regeneration Token System
 *
 * Manages per-campaign regeneration token balances.
 * Each campaign gets 3 free tokens on creation (cap: 10).
 * Tokens are consumed on image/video regeneration and refunded on failure.
 *
 * All balance mutations use serializable transactions to prevent
 * race conditions when concurrent requests compete for the last token.
 */

import prisma from '../lib/prisma';
import { createLogger } from '../utils/logger';

const logger = createLogger({ service: 'token-service' });

// ── Constants ─────────────────────────────────────────────────────────────────

export const TOKEN_INITIAL_GRANT = 3;
export const TOKEN_CAP = 10;

export type TokenTransactionType = 'INITIAL_GRANT' | 'DEBIT' | 'REFUND' | 'GRANT';

// ── Error classes ─────────────────────────────────────────────────────────────

export class InsufficientTokensError extends Error {
  public readonly balance: number;
  constructor(balance: number) {
    super('Insufficient regeneration tokens');
    this.name = 'InsufficientTokensError';
    this.balance = balance;
  }
}

export class TokenCapExceededError extends Error {
  public readonly currentBalance: number;
  public readonly maxGrantable: number;
  constructor(currentBalance: number, maxGrantable: number) {
    super(`Grant would exceed token cap of ${TOKEN_CAP}. Maximum grantable: ${maxGrantable}`);
    this.name = 'TokenCapExceededError';
    this.currentBalance = currentBalance;
    this.maxGrantable = maxGrantable;
  }
}

// ── Phase 1: Initialize ledger on campaign creation ───────────────────────────

/**
 * Creates a token ledger for a campaign with the initial free grant.
 * Idempotent — safe to call multiple times; skips if ledger already exists.
 */
export async function initializeCampaignTokens(campaignId: string): Promise<void> {
  // Check if ledger already exists
  const existing = await prisma.campaignTokenLedger.findUnique({
    where: { campaignId },
  });

  if (existing) {
    logger.info(`Token ledger already exists for campaign ${campaignId} — skipping init`);
    return;
  }

  // Create ledger + initial grant transaction atomically
  await prisma.$transaction(async (tx: any) => {
    const ledger = await tx.campaignTokenLedger.create({
      data: {
        campaignId,
        balance: TOKEN_INITIAL_GRANT,
      },
    });

    await tx.campaignTokenTransaction.create({
      data: {
        campaignId,
        ledgerId: ledger.id,
        type: 'INITIAL_GRANT' as TokenTransactionType,
        amount: TOKEN_INITIAL_GRANT,
        balanceAfter: TOKEN_INITIAL_GRANT,
        description: 'Initial free tokens',
      },
    });
  });

  logger.info(`Token ledger initialized for campaign ${campaignId} with ${TOKEN_INITIAL_GRANT} tokens`);
}

// ── Phase 2: Query balance ────────────────────────────────────────────────────

export interface TokenBalance {
  balance: number;
  transactions: TokenTransactionRecord[];
}

export interface TokenTransactionRecord {
  id: string;
  campaignId: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string;
  postId: string | null;
  createdAt: Date;
}

/**
 * Returns the current token balance and full transaction history for a campaign.
 * Throws if the campaign has no ledger (404 scenario).
 */
export async function getCampaignTokenBalance(campaignId: string): Promise<TokenBalance> {
  let ledger = await prisma.campaignTokenLedger.findUnique({
    where: { campaignId },
    include: {
      transactions: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  // Auto-initialize ledger for campaigns created before the token system
  if (!ledger) {
    await initializeCampaignTokens(campaignId);
    ledger = await prisma.campaignTokenLedger.findUnique({
      where: { campaignId },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  if (!ledger) {
    throw new Error(`Failed to initialize token ledger for campaign ${campaignId}`);
  }

  return {
    balance: ledger.balance,
    transactions: ledger.transactions,
  };
}

// ── Phase 3: Atomic debit ─────────────────────────────────────────────────────

/**
 * Atomically checks balance and debits 1 token.
 * Uses a serializable transaction + SELECT FOR UPDATE to prevent race conditions.
 *
 * @throws InsufficientTokensError if balance is 0
 */
export async function debitToken(campaignId: string, postId: string): Promise<void> {
  await prisma.$transaction(
    async (tx: any) => {
      // Lock the ledger row for this transaction
      const ledgers = await tx.$queryRaw`
        SELECT id, balance
        FROM social.campaign_token_ledgers
        WHERE campaign_id = ${campaignId}
        FOR UPDATE
      `;

      const ledger = (ledgers as any[])[0];

      if (!ledger) {
        throw new Error(`No token ledger found for campaign ${campaignId}`);
      }

      if (ledger.balance <= 0) {
        throw new InsufficientTokensError(ledger.balance);
      }

      const newBalance = ledger.balance - 1;

      // Decrement balance
      await tx.$executeRaw`
        UPDATE social.campaign_token_ledgers
        SET balance = ${newBalance}, updated_at = NOW()
        WHERE id = ${ledger.id}
      `;

      // Record transaction
      await tx.campaignTokenTransaction.create({
        data: {
          campaignId,
          ledgerId: ledger.id,
          type: 'DEBIT' as TokenTransactionType,
          amount: 1,
          balanceAfter: newBalance,
          description: 'Regeneration debit',
          postId,
        },
      });
    },
    { isolationLevel: 'Serializable' }
  );

  logger.info(`Token debited for campaign ${campaignId}, post ${postId}`);
}

// ── Phase 4: Refund on failure ────────────────────────────────────────────────

/**
 * Refunds 1 token to the campaign ledger after a failed generation.
 * Best-effort — logs on failure but does not throw.
 */
export async function refundToken(campaignId: string, postId: string): Promise<void> {
  try {
    await prisma.$transaction(async (tx: any) => {
      const ledger = await tx.campaignTokenLedger.findUnique({
        where: { campaignId },
      });

      if (!ledger) {
        throw new Error(`No token ledger found for campaign ${campaignId}`);
      }

      const newBalance = Math.min(ledger.balance + 1, TOKEN_CAP);

      await tx.campaignTokenLedger.update({
        where: { id: ledger.id },
        data: { balance: newBalance },
      });

      await tx.campaignTokenTransaction.create({
        data: {
          campaignId,
          ledgerId: ledger.id,
          type: 'REFUND' as TokenTransactionType,
          amount: 1,
          balanceAfter: newBalance,
          description: 'Refund: generation failed',
          postId,
        },
      });
    });

    logger.info(`Token refunded for campaign ${campaignId}, post ${postId}`);
  } catch (err: any) {
    logger.error(`Token refund FAILED for campaign ${campaignId}, post ${postId}: ${err.message}`);
    // Best-effort — do not rethrow
  }
}

// ── Phase 5: Admin grant ──────────────────────────────────────────────────────

/**
 * Grants additional tokens to a campaign (admin only).
 * Refuses if the resulting balance would exceed TOKEN_CAP.
 *
 * @throws TokenCapExceededError if grant would exceed cap
 */
export async function grantTokens(campaignId: string, amount: number): Promise<number> {
  const ledger = await prisma.campaignTokenLedger.findUnique({
    where: { campaignId },
  });

  if (!ledger) {
    throw new Error(`No token ledger found for campaign ${campaignId}`);
  }

  const newBalance = ledger.balance + amount;
  if (newBalance > TOKEN_CAP) {
    const maxGrantable = TOKEN_CAP - ledger.balance;
    throw new TokenCapExceededError(ledger.balance, maxGrantable);
  }

  await prisma.$transaction(async (tx: any) => {
    await tx.campaignTokenLedger.update({
      where: { id: ledger.id },
      data: { balance: newBalance },
    });

    await tx.campaignTokenTransaction.create({
      data: {
        campaignId,
        ledgerId: ledger.id,
        type: 'GRANT' as TokenTransactionType,
        amount,
        balanceAfter: newBalance,
        description: 'Admin token grant',
      },
    });
  });

  logger.info(`Granted ${amount} tokens to campaign ${campaignId}. New balance: ${newBalance}`);
  return newBalance;
}
