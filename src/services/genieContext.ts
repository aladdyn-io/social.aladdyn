/**
 * Genie Context Service
 *
 * Fetches scraped website knowledge from genie.aladdyn for a given funnel.
 * Used to ground content generation in the client's actual business content.
 */

import axios from 'axios';

const GENIE_URL = process.env.GENIE_SERVICE_URL ?? 'http://localhost:3004';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'aladdyn-internal-secret';

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
  try {
    const response = await axios.get(
      `${GENIE_URL}/internal/funnel/${funnelId}/context`,
      {
        headers: { 'x-internal-secret': INTERNAL_SECRET },
        timeout: 8000,
      }
    );

    if (response.data?.success) {
      return response.data.data as GenieContext;
    }

    return null;
  } catch (error: any) {
    // Genie might be down or funnel has no scraped data yet — non-fatal
    console.warn(
      `[GenieContext] Could not fetch context for funnel ${funnelId}:`,
      error?.message || 'Unknown error'
    );
    return null;
  }
}
