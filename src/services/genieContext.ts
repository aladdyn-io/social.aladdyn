/**
 * Genie Context Service
 *
 * Fetches scraped website knowledge from genie.aladdyn for a given funnel.
 * Used to ground content generation in the client's actual business content.
 */

import axios from 'axios';

const GENIE_URL = process.env.GENIE_SERVICE_URL ?? 'http://localhost:3004';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'aladdyn-internal-secret';

// Short-lived cache — deduplicates rapid repeat calls for the same funnelId
// (e.g. multiple React hooks firing on the same page load)
const cache = new Map<string, { value: GenieContext | null; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

export interface GenieContext {
  companyName?: string;
  industry?: string;
  geography?: string;
  tone?: string;
  websiteUrl?: string;
  websiteSummary: string; // compiled text from scraped content
  brandColor?: string | null;
  brandAccentColor?: string | null;
  brandLogo?: string | null;
}

/**
 * Fetches brand context and scraped website knowledge for a funnel.
 * Falls back gracefully if genie is unreachable or has no data.
 */
export async function fetchGenieContext(funnelId: string): Promise<GenieContext | null> {
  const cached = cache.get(funnelId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value: GenieContext | null = null;

  try {
    const response = await axios.get(
      `${GENIE_URL}/internal/funnel/${funnelId}/context`,
      {
        headers: { 'x-internal-secret': INTERNAL_SECRET },
        timeout: 8000,
      }
    );

    if (response.data?.success) {
      value = response.data.data as GenieContext;
    }
  } catch (error: any) {
    // 404 = funnel not in genie DB yet (expected before onboarding completes)
    // Other errors = genie down or transient — all handled by returning null
    console.debug(
      `[GenieContext] No genie data for funnel ${funnelId}: ${error?.message ?? 'unknown'}`
    );
  }

  cache.set(funnelId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}
