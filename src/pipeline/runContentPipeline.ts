/**
 * Main Content Generation Pipeline
 *
 * Orchestrates: normalize → genie context → strategy → calendar → posts → save
 * Entry point: called from server.ts routes.
 */

import { ContentInput, ContentOutput, FestivalEvent } from '../types/content';
import { normalizeInput } from '../services/normalizeInput';
import { generateStrategy } from '../services/generateStrategy';
import { generateCalendar } from '../services/generateCalendar';
import { generatePosts } from '../services/generatePosts';
import { fetchGenieContext } from '../services/genieContext';
import {
  savePostsToDB,
  saveStrategyToDB,
  saveCalendarToDB,
} from '../db/database';

function getCountryCode(geography: string): string {
  const mapping: Record<string, string> = {
    india: 'IN',
    'united states': 'US',
    usa: 'US',
    uk: 'GB',
    'united kingdom': 'GB',
    canada: 'CA',
    australia: 'AU',
    singapore: 'SG',
    uae: 'AE',
  };
  return mapping[geography.toLowerCase()] || 'IN';
}

export async function runContentPipeline(
  input: ContentInput,
  campaignId?: string,
  funnelId?: string
): Promise<ContentOutput> {
  try {
    // ── Step 1: Fetch Genie Context (website knowledge + business profile) ───
    let websiteContext: string | undefined;
    let enrichedInput = input;
    if (funnelId) {
      const genieCtx = await fetchGenieContext(funnelId);
      if (genieCtx) {
        if (genieCtx.websiteSummary) {
          websiteContext = genieCtx.websiteSummary;
          console.log(`[Pipeline] Got website context (${websiteContext.length} chars) from genie`);
        }
        // Auto-populate missing input fields from scraped data
        enrichedInput = {
          ...input,
          industry: input.industry?.trim() || genieCtx.industry || 'General Business',
          geography: input.geography?.trim() || genieCtx.geography || 'India',
          services: (input.services?.length ?? 0) > 0 ? input.services : ['Our Services'],
        };
        console.log(`[Pipeline] Enriched input — industry: ${enrichedInput.industry}, geography: ${enrichedInput.geography}`);
      } else {
        console.log('[Pipeline] No genie context available — using input data only');
        enrichedInput = {
          ...input,
          industry: input.industry?.trim() || 'General Business',
          geography: input.geography?.trim() || 'India',
          services: (input.services?.length ?? 0) > 0 ? input.services : ['Our Services'],
        };
      }
    } else {
      // No funnelId — still apply fallbacks so normalizeInput doesn't throw
      enrichedInput = {
        ...input,
        industry: input.industry?.trim() || 'General Business',
        geography: input.geography?.trim() || 'India',
        services: (input.services?.length ?? 0) > 0 ? input.services : ['Our Services'],
      };
    }

    // ── Step 2: Normalize ────────────────────────────────────────────────────
    const normalizedInput = normalizeInput(enrichedInput);

    // ── Step 3: Generate Strategy ─────────────────────────────────────────────
    const strategy = await generateStrategy(normalizedInput, websiteContext);

    let strategyId: string | undefined;
    if (campaignId) {
      try {
        strategyId = await saveStrategyToDB(campaignId, strategy);
        console.log(`[Pipeline] Strategy saved: ${strategyId}`);
      } catch (err) {
        console.error('[Pipeline] Failed to save strategy (non-fatal):', err);
      }
    }

    // ── Step 4: Fetch Festivals ──────────────────────────────────────────────
    let festivals: FestivalEvent[] = [];
    if (normalizedInput.festival_enabled) {
      try {
        const { getFestivalsForDateRange } = await import('../services/festivalApi');
        const startDate = new Date();
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + normalizedInput.total_days);
        festivals = await getFestivalsForDateRange(
          startDate,
          endDate,
          getCountryCode(normalizedInput.geography)
        );
        console.log(`[Pipeline] Loaded ${festivals.length} festivals`);
      } catch (err) {
        console.error('[Pipeline] Festival fetch failed (non-fatal):', err);
      }
    }

    // ── Step 5: Generate Calendar ────────────────────────────────────────────
    const calendar = await generateCalendar(normalizedInput, strategy, festivals, campaignId);

    if (campaignId && strategyId) {
      try {
        await saveCalendarToDB(campaignId, strategyId, calendar);
        console.log(`[Pipeline] Calendar saved: ${calendar.length} entries`);
      } catch (err) {
        console.error('[Pipeline] Failed to save calendar (non-fatal):', err);
      }
    }

    // ── Step 6: Generate Posts (captions + image prompts) ────────────────────
    const posts = await generatePosts(calendar, normalizedInput, strategy, websiteContext);

    // ── Step 7: Save Posts ───────────────────────────────────────────────────
    if (campaignId) {
      try {
        const savedIds = await savePostsToDB(campaignId, posts);
        console.log(`[Pipeline] Saved ${savedIds.length} posts`);
      } catch (err) {
        console.error('[Pipeline] Failed to save posts (non-fatal):', err);
      }
    }

    return { strategy, calendar, posts };
  } catch (error) {
    throw new Error(
      `Pipeline failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
