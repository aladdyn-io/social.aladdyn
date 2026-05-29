/**
 * OAuth Service
 *
 * Handles:
 *  - AES-256-GCM encryption/decryption for storing tokens securely at rest
 *  - LinkedIn OAuth 2.0 authorization URL construction + token exchange
 *  - Meta (Facebook/Instagram) OAuth 2.0 authorization URL + token exchange
 *  - Upsert helpers to save/update SocialAccount rows in Prisma
 */

import crypto from 'crypto';
import axios from 'axios';
import prisma from '../lib/prisma';
import { SocialAccountPlatform } from '@prisma/client';

// ── Encryption ────────────────────────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm';

/**
 * Returns the 32-byte encryption key from env.
 * Throws clearly if not configured rather than silently using a weak key.
 */
function getEncryptionKey(): Buffer {
  const hex = process.env.OAUTH_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      '[oauthService] OAUTH_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypts a plaintext token string using AES-256-GCM.
 * Returns a single storable string: "<iv_hex>:<ciphertext_hex>:<authTag_hex>"
 */
export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${encrypted}:${authTag}`;
}

/**
 * Decrypts a token stored by encryptToken().
 */
export function decryptToken(stored: string): string {
  const parts = stored.split(':');
  if (parts.length !== 3) {
    throw new Error('[oauthService] Invalid encrypted token format');
  }
  const [ivHex, encryptedHex, authTagHex] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ── CSRF State helpers ─────────────────────────────────────────────────────────

/**
 * Generates a cryptographically random state string for CSRF protection.
 * Store this in a short-lived server-side session or signed cookie before redirect.
 */
export function generateOAuthState(): string {
  return crypto.randomBytes(20).toString('hex');
}

// ── LinkedIn ──────────────────────────────────────────────────────────────────

const LINKEDIN_AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const LINKEDIN_USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';

export interface LinkedInTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;         // seconds until access token expires
  refreshTokenExpiresIn?: number;
}

export interface LinkedInProfile {
  sub: string;               // the member ID (used to build urn:li:person:<sub>)
  name: string;
  email?: string;
  picture?: string;
  vanityName?: string;       // LinkedIn public profile slug
}

/**
 * Builds the LinkedIn OAuth authorization URL to redirect the user to.
 * Scopes:
 *   w_member_social      — post to the member's personal feed
 *   w_organization_social — post to Company Pages (requires Community Management API approval)
 *   r_organization_social — read org profile (to confirm page admin status)
 *   openid profile email  — get user identity via OIDC userinfo endpoint
 */
export function buildLinkedInAuthUrl(state: string): string {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    throw new Error('[oauthService] LINKEDIN_CLIENT_ID and LINKEDIN_REDIRECT_URI must be set in .env');
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: 'openid profile email w_member_social',
  });

  return `${LINKEDIN_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchanges the authorization code returned by LinkedIn for access + refresh tokens.
 */
export async function exchangeLinkedInCode(code: string): Promise<LinkedInTokens> {
  const clientId = process.env.LINKEDIN_CLIENT_ID!;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET!;
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI!;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await axios.post<{
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
  }>(LINKEDIN_TOKEN_URL, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  return {
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token,
    expiresIn: res.data.expires_in,
    refreshTokenExpiresIn: res.data.refresh_token_expires_in,
  };
}

/**
 * Fetches the authenticated LinkedIn member's basic profile via OIDC userinfo.
 * Returns the `sub` field which is used to build the author URN for posting.
 */
export async function getLinkedInProfile(accessToken: string): Promise<LinkedInProfile> {
  const res = await axios.get<{
    sub: string;
    name: string;
    email?: string;
    picture?: string;
    vanityName?: string;
  }>(LINKEDIN_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return {
    sub: res.data.sub,
    name: res.data.name,
    email: res.data.email,
    picture: res.data.picture,
    vanityName: res.data.vanityName,
  };
}

// ── Instagram Business Login (Instagram-native OAuth — no Facebook required) ──
//
// This uses the newer Instagram Business Login flow that goes directly to
// instagram.com/oauth/authorize. No Facebook Pages or Facebook login needed.
// Docs: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login

const IG_AUTH_URL = 'https://api.instagram.com/oauth/authorize';
const IG_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const IG_GRAPH_URL = 'https://graph.instagram.com';

export interface InstagramTokens {
  shortLivedToken: string;
  longLivedToken: string;
  expiresIn: number;             // seconds (~60 days)
  userId: string;
}

export interface InstagramProfile {
  id: string;
  /** The actual IG user ID for content publishing (may differ from node `id`) */
  igUserId: string;
  username: string;
  name?: string;
  profilePictureUrl?: string;
  accountType?: string;
}

/**
 * Builds the Instagram Business Login authorization URL.
 * Redirects directly to instagram.com — no Facebook login required.
 * Uses the Instagram App ID (different from the Facebook App ID).
 */
export function buildMetaAuthUrl(state: string): string {
  const appId = process.env.INSTAGRAM_APP_ID;
  const redirectUri = process.env.META_REDIRECT_URI;

  if (!appId || !redirectUri) {
    throw new Error('[oauthService] INSTAGRAM_APP_ID and META_REDIRECT_URI must be set in .env');
  }

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: [
      'instagram_business_basic',
      'instagram_business_content_publish',
    ].join(','),
    state,
  });

  return `${IG_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchanges the Instagram authorization code for a short-lived token,
 * then upgrades it to a 60-day long-lived token.
 * Uses the Instagram App ID/Secret (not the Facebook App ID/Secret).
 */
export async function exchangeMetaCode(code: string): Promise<InstagramTokens> {
  const appId = process.env.INSTAGRAM_APP_ID!;
  const appSecret = process.env.INSTAGRAM_APP_SECRET!;
  const redirectUri = process.env.META_REDIRECT_URI!;

  // Strip trailing `#_` that Instagram sometimes appends to the code
  const cleanCode = code.replace(/#_$/, '');

  // Instagram token endpoint — use URLSearchParams (application/x-www-form-urlencoded)
  // The curl docs show -F (multipart) but url-encoded works and is simpler
  const body = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code: cleanCode,
  });

  console.log('[oauthService] Exchanging IG code, redirect_uri:', redirectUri);
  console.log('[oauthService] Using INSTAGRAM_APP_ID:', appId);

  let shortRes: any;
  try {
    shortRes = await axios.post(
      'https://api.instagram.com/oauth/access_token',
      body.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
  } catch (err: any) {
    const errBody = err.response?.data;
    console.error('[oauthService] IG token exchange error:', err.response?.status);
    console.error('[oauthService] IG error body:', JSON.stringify(errBody, null, 2));
    console.error('[oauthService] Code used (first 20 chars):', cleanCode?.substring(0, 20));
    throw err;
  }

  // Response: { access_token, user_id, permissions } (flat object)
  const raw = shortRes.data;
  const tokenData = Array.isArray(raw?.data) ? raw.data[0] : raw;
  const shortLivedToken: string = tokenData.access_token;
  const userId: string = String(tokenData.user_id);

  console.log('[oauthService] Short-lived token obtained for userId:', userId);

  // Step 2: Exchange for 60-day long-lived token
  let longRes: any;
  try {
    longRes = await axios.get(
      `${IG_GRAPH_URL}/access_token`,
      {
        params: {
          grant_type: 'ig_exchange_token',
          client_secret: appSecret,
          access_token: shortLivedToken,
        },
      }
    );
  } catch (err: any) {
    console.error('[oauthService] Long-lived token exchange error:', err.response?.status, JSON.stringify(err.response?.data, null, 2));
    throw err;
  }

  console.log('[oauthService] Long-lived token obtained, expires_in:', longRes.data.expires_in);

  return {
    shortLivedToken,
    longLivedToken: longRes.data.access_token,
    expiresIn: longRes.data.expires_in,
    userId,
  };
}

/**
 * Fetches the Instagram Business account profile using the long-lived token.
 * Uses /me endpoint (Instagram-native flow) not /{userId}.
 */
export async function getInstagramProfile(longLivedToken: string, _userId: string): Promise<InstagramProfile> {
  const res = await axios.get<{
    id: string;
    user_id: string;
    username: string;
    name?: string;
    profile_picture_url?: string;
    account_type?: string;
  }>(`${IG_GRAPH_URL}/me`, {
    params: {
      fields: 'id,user_id,username,name,profile_picture_url,account_type',
      access_token: longLivedToken,
    },
  });

  console.log(`[oauthService] /me response — id: ${res.data.id}, user_id: ${res.data.user_id}, username: ${res.data.username}`);

  return {
    id: res.data.id,
    igUserId: res.data.user_id ?? res.data.id, // user_id is the publishing ID; fall back to id
    username: res.data.username,
    name: res.data.name,
    profilePictureUrl: res.data.profile_picture_url,
    accountType: res.data.account_type,
  };
}

// ── Instagram Token Refresh ───────────────────────────────────────────────────

/**
 * Refreshes a long-lived Instagram User Access Token.
 * The token must be at least 24 hours old and not yet expired.
 * Returns a new long-lived token valid for another 60 days.
 *
 * Docs: https://developers.facebook.com/docs/instagram-platform/reference/refresh_access_token
 */
export async function refreshInstagramToken(
  currentLongLivedToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await axios.get<{
    access_token: string;
    token_type: string;
    expires_in: number;
  }>(`${IG_GRAPH_URL}/refresh_access_token`, {
    params: {
      grant_type: 'ig_refresh_token',
      access_token: currentLongLivedToken,
    },
  });

  return {
    accessToken: res.data.access_token,
    expiresIn: res.data.expires_in,
  };
}

/**
 * Ensures the Instagram SocialAccount token is fresh before publishing.
 * If the token expires within 7 days (or is already expired), it attempts
 * to refresh it via Meta's /refresh_access_token endpoint and updates
 * the encrypted DB record in-place.
 *
 * Returns the decrypted, ready-to-use access token.
 */
export async function ensureFreshInstagramToken(
  accountId: string,
  encryptedToken: string,
  tokenExpiresAt: Date | null
): Promise<string> {
  const currentToken = decryptToken(encryptedToken);

  // If no expiry is recorded or the token expires more than 7 days from now, it's fine
  if (!tokenExpiresAt) return currentToken;
  const msUntilExpiry = tokenExpiresAt.getTime() - Date.now();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  if (msUntilExpiry > SEVEN_DAYS_MS) {
    return currentToken; // still fresh
  }

  // Token is expiring soon or already expired — try refreshing
  console.log(`[oauthService] Instagram token for account ${accountId} expires in ${Math.round(msUntilExpiry / 1000 / 60 / 60)}h — refreshing...`);

  try {
    const refreshed = await refreshInstagramToken(currentToken);
    const newExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);

    // Re-encrypt and persist the new token
    const newEncrypted = encryptToken(refreshed.accessToken);
    await prisma.socialAccount.update({
      where: { id: accountId },
      data: {
        accessToken: newEncrypted,
        tokenExpiresAt: newExpiresAt,
        updatedAt: new Date(),
      },
    });

    console.log(`[oauthService] ✓ Instagram token refreshed for account ${accountId}, new expiry: ${newExpiresAt.toISOString()}`);
    return refreshed.accessToken;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[oauthService] Failed to refresh Instagram token for account ${accountId}: ${msg}`);

    // If the token is already fully expired, we can't recover — throw
    if (msUntilExpiry <= 0) {
      throw new Error(
        'Instagram access token expired and could not be refreshed. ' +
        'Reconnect your Instagram account in the Social Scene settings to resume publishing.'
      );
    }

    // Token is still valid (just expiring soon) — use it anyway
    return currentToken;
  }
}

// ── SocialAccount DB helpers ──────────────────────────────────────────────────

export interface UpsertSocialAccountParams {
  userId: string;
  platform: SocialAccountPlatform;
  platformAccountId: string;
  authorUrn?: string;
  accountName: string;
  accountHandle?: string;
  profilePictureUrl?: string;
  accessToken: string;           // PLAINTEXT — will be encrypted before saving
  refreshToken?: string;         // PLAINTEXT — will be encrypted before saving
  tokenExpiresAt?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Creates or updates a SocialAccount row for the given user + platform + account.
 * Encrypts tokens before writing to the database.
 * Uses upsert so reconnecting an already-linked account refreshes the token.
 */
export async function upsertSocialAccount(params: UpsertSocialAccountParams) {
  const {
    userId,
    platform,
    platformAccountId,
    authorUrn,
    accountName,
    accountHandle,
    profilePictureUrl,
    accessToken,
    refreshToken,
    tokenExpiresAt,
    metadata,
  } = params;

  const encryptedAccess = encryptToken(accessToken);
  const encryptedRefresh = refreshToken ? encryptToken(refreshToken) : undefined;

  return prisma.socialAccount.upsert({
    where: {
      userId_platform_platformAccountId: { userId, platform, platformAccountId },
    },
    create: {
      userId,
      platform,
      platformAccountId,
      authorUrn,
      accountName,
      accountHandle,
      profilePictureUrl,
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      tokenExpiresAt,
      metadata: metadata as any,
      isActive: true,
    },
    update: {
      authorUrn,
      accountName,
      accountHandle,
      profilePictureUrl,
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      tokenExpiresAt,
      metadata: metadata as any,
      isActive: true,
      updatedAt: new Date(),
    },
  });
}
