/**
 * OAuth Routes
 *
 * Handles "Connect with LinkedIn" and "Connect with Instagram" flows.
 *
 * LinkedIn endpoints:
 *   GET /api/v1/auth/linkedin/connect   — returns the authorization URL
 *   GET /api/v1/auth/linkedin/callback  — exchanges code, saves SocialAccount
 *
 * Meta endpoints (Phase 3 — populated once META_APP_ID is configured):
 *   GET /api/v1/auth/meta/connect       — returns the Facebook OAuth URL
 *   GET /api/v1/auth/meta/callback      — exchanges code, saves all IG accounts
 *
 * Account management endpoints:
 *   GET    /api/v1/social-accounts      — list connected accounts for current user
 *   DELETE /api/v1/social-accounts/:id  — disconnect (set isActive = false)
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { ApiErrorCode } from '../types/api';
import prisma from '../lib/prisma';
import {
  buildLinkedInAuthUrl,
  exchangeLinkedInCode,
  getLinkedInProfile,
  upsertSocialAccount,
  generateOAuthState,
  decryptToken,
  // Meta / Instagram Business Login
  buildMetaAuthUrl,
  exchangeMetaCode,
  getInstagramProfile,
} from '../services/oauthService';
import { SocialAccountPlatform } from '@prisma/client';

const router = Router();

// In-memory CSRF state store (per process).
// For multi-instance deployments, replace with Redis or signed JWT cookies.
const pendingStates = new Map<string, { userId: string; expiresAt: number }>();

function storeState(state: string, userId: string): void {
  pendingStates.set(state, { userId, expiresAt: Date.now() + 10 * 60 * 1000 }); // 10 min TTL
  // Clean up expired states
  for (const [k, v] of pendingStates.entries()) {
    if (v.expiresAt < Date.now()) pendingStates.delete(k);
  }
}

function consumeState(state: string): string | null {
  const entry = pendingStates.get(state);
  if (!entry || entry.expiresAt < Date.now()) return null;
  pendingStates.delete(state);
  return entry.userId;
}

// ── LinkedIn ──────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/auth/linkedin/connect
 *
 * Returns the LinkedIn OAuth authorization URL.
 * The frontend should redirect the user's browser to this URL.
 *
 * Response: { success: true, data: { authUrl: string } }
 */
router.get(
  '/linkedin/connect',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const state = generateOAuthState();
    storeState(state, userId);

    const authUrl = buildLinkedInAuthUrl(state);

    res.json({
      success: true,
      data: { authUrl },
      meta: { timestamp: new Date().toISOString() },
    });
  })
);

/**
 * GET /api/v1/auth/linkedin/callback
 *
 * LinkedIn redirects here after the user approves (or denies) the connection.
 * Exchanges the authorization code for tokens, fetches the member profile,
 * and upserts a SocialAccount row.
 *
 * On success: redirects to FRONTEND_URL/settings?connected=linkedin
 * On error:   redirects to FRONTEND_URL/settings?error=linkedin_<reason>
 */
router.get(
  '/linkedin/callback',
  asyncHandler(async (req: Request, res: Response) => {
    const { code, state, error, error_description } = req.query as Record<string, string>;
    const frontendUrl = process.env.FRONTEND_URL || '';
    const fallbackUrl = frontendUrl ? `${frontendUrl}/settings` : '/demo.html';

    // User denied the authorization
    if (error) {
      console.warn(`[LinkedIn OAuth] User denied authorization: ${error} — ${error_description}`);
      return res.redirect(`${fallbackUrl}?error=linkedin_denied`);
    }

    // CSRF state validation
    const userId = consumeState(state);
    if (!userId) {
      console.error('[LinkedIn OAuth] Invalid or expired state token');
      return res.redirect(`${fallbackUrl}?error=linkedin_invalid_state`);
    }

    if (!code) {
      return res.redirect(`${fallbackUrl}?error=linkedin_no_code`);
    }

    try {
      // 1. Exchange code → tokens
      const tokens = await exchangeLinkedInCode(code);

      // 2. Fetch LinkedIn profile to get member sub (used as platformAccountId and author URN)
      const profile = await getLinkedInProfile(tokens.accessToken);

      const authorUrn = `urn:li:person:${profile.sub}`;
      const tokenExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
      const refreshExpiresAt = tokens.refreshTokenExpiresIn
        ? new Date(Date.now() + tokens.refreshTokenExpiresIn * 1000)
        : undefined;

      // 3. Upsert SocialAccount (encrypts tokens before writing)
      const account = await upsertSocialAccount({
        userId,
        platform: SocialAccountPlatform.LINKEDIN,
        platformAccountId: profile.sub,
        authorUrn,
        accountName: profile.name,
        accountHandle: profile.vanityName,
        profilePictureUrl: profile.picture,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt,
        metadata: {
          email: profile.email,
          refreshTokenExpiresAt: refreshExpiresAt?.toISOString(),
        },
      });

      console.log(`[LinkedIn OAuth] ✓ Connected account "${profile.name}" for user ${userId} (SocialAccount: ${account.id})`);

      return res.redirect(
        `${fallbackUrl}?connected=linkedin&account=${encodeURIComponent(profile.name)}`
      );
    } catch (err) {
      console.error('[LinkedIn OAuth] Callback error:', err instanceof Error ? err.message : err);
      return res.redirect(`${fallbackUrl}?error=linkedin_exchange_failed`);
    }
  })
);

// ── Meta / Instagram ──────────────────────────────────────────────────────────

/**
 * GET /api/v1/auth/meta/connect
 *
 * Returns the Facebook OAuth dialog URL.
 * Only works once META_APP_ID and META_APP_SECRET are configured in .env.
 */
router.get(
  '/meta/connect',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    if (!process.env.META_APP_ID && !process.env.INSTAGRAM_APP_ID) {
      throw new AppError(
        ApiErrorCode.INVALID_INPUT,
        'Meta app not configured yet. Set META_APP_ID and META_APP_SECRET in .env.',
        503
      );
    }

    const userId = req.user!.id;
    const state = generateOAuthState();
    storeState(state, userId);

    const authUrl = buildMetaAuthUrl(state);

    res.json({
      success: true,
      data: { authUrl },
      meta: { timestamp: new Date().toISOString() },
    });
  })
);

/**
 * GET /api/v1/auth/meta/callback
 *
 * Meta redirects here after the user approves Instagram permissions.
 * Exchanges the code, upgrades to long-lived token, discovers all linked
 * Instagram Business accounts, and creates a SocialAccount row for each.
 */
router.get(
  '/meta/callback',
  asyncHandler(async (req: Request, res: Response) => {
    const { code, state, error, error_description } = req.query as Record<string, string>;
    const frontendUrl = process.env.FRONTEND_URL || '';
    const fallbackUrl = frontendUrl ? `${frontendUrl}/settings` : '/demo.html';

    if (error) {
      console.warn(`[Meta OAuth] User denied authorization: ${error} — ${error_description}`);
      return res.redirect(`${fallbackUrl}?error=meta_denied`);
    }

    const userId = consumeState(state);
    if (!userId) {
      console.error('[Meta OAuth] Invalid or expired state token');
      return res.redirect(`${fallbackUrl}?error=meta_invalid_state`);
    }

    if (!code) {
      return res.redirect(`${fallbackUrl}?error=meta_no_code`);
    }

    // Instagram sometimes appends #_ to the code — strip it
    const cleanCode = code.replace(/#_$/, '');

    try {
      // 1. Exchange code → long-lived Instagram user token
      const igTokens = await exchangeMetaCode(cleanCode);

      // 2. Fetch Instagram Business profile
      const profile = await getInstagramProfile(igTokens.longLivedToken, igTokens.userId);

      // DEBUG — log profile to server console
      console.log(`[Meta OAuth] Instagram profile:`, JSON.stringify(profile, null, 2));

      const tokenExpiresAt = new Date(Date.now() + igTokens.expiresIn * 1000);

      // 3. Upsert SocialAccount — use igUserId (the publishing ID) as platformAccountId
      await upsertSocialAccount({
        userId,
        platform: SocialAccountPlatform.INSTAGRAM,
        platformAccountId: profile.igUserId,
        accountName: profile.name || profile.username,
        accountHandle: `@${profile.username}`,
        profilePictureUrl: profile.profilePictureUrl,
        accessToken: igTokens.longLivedToken,
        tokenExpiresAt,
        metadata: {
          accountType: profile.accountType,
          nodeId: profile.id,          // /me node ID (for reference)
          userId: igTokens.userId,     // token exchange user ID
        },
      });

      console.log(`[Meta OAuth] ✓ Connected Instagram @${profile.username} for user ${userId}`);

      return res.redirect(
        `${fallbackUrl}?connected=instagram&accounts=${encodeURIComponent(profile.username)}`
      );
    } catch (err) {
      const axiosBody = (err as any)?.response?.data;
      console.error('[Meta OAuth] Callback error:', err instanceof Error ? err.message : err);
      if (axiosBody) console.error('[Meta OAuth] API response body:', JSON.stringify(axiosBody, null, 2));
      return res.redirect(`${fallbackUrl}?error=meta_exchange_failed`);
    }
  })
);

// ── Account Management ────────────────────────────────────────────────────────

/**
 * GET /api/v1/social-accounts
 *
 * Lists all connected social accounts for the current authenticated user.
 * Tokens are NOT returned — only display metadata.
 */
router.get(
  '/social-accounts',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;

    const accounts = await prisma.socialAccount.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        platform: true,
        platformAccountId: true,
        accountName: true,
        accountHandle: true,
        profilePictureUrl: true,
        authorUrn: true,
        tokenExpiresAt: true,
        metadata: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        // Never return accessToken or refreshToken
      },
    });

    res.json({
      success: true,
      data: { accounts, total: accounts.length },
      meta: { timestamp: new Date().toISOString() },
    });
  })
);

/**
 * DELETE /api/v1/social-accounts/:accountId
 *
 * Soft-deletes a connected social account (sets isActive = false).
 * The account's campaigns are NOT affected — they'll fall back to env credentials.
 */
router.delete(
  '/social-accounts/:accountId',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { accountId } = req.params;

    const account = await prisma.socialAccount.findFirst({
      where: { id: accountId, userId },
      select: { id: true, accountName: true, platform: true },
    });

    if (!account) {
      throw new AppError(ApiErrorCode.CAMPAIGN_NOT_FOUND, 'Social account not found', 404);
    }

    await prisma.socialAccount.update({
      where: { id: accountId },
      data: { isActive: false },
    });

    console.log(`[OAuth] Disconnected ${account.platform} account "${account.accountName}" for user ${userId}`);

    res.json({
      success: true,
      data: {
        message: `${account.platform} account "${account.accountName}" disconnected successfully.`,
        accountId,
      },
      meta: { timestamp: new Date().toISOString() },
    });
  })
);

export default router;
