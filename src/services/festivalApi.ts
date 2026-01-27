/**
 * Festival API Service
 * 
 * Fetches real festival/holiday data from Calendarific API
 * Free tier: 1000 requests/month
 * 
 * Features:
 * - Accurate dates for 200+ countries
 * - Automatic updates when dates change
 * - Caching to reduce API calls
 */

import axios from 'axios';
import { FestivalEvent } from '../types/content';

interface CalendarificHoliday {
  name: string;
  description: string;
  date: {
    iso: string; // YYYY-MM-DD
    datetime: {
      year: number;
      month: number;
      day: number;
    };
  };
  type: string[]; // e.g., ["National holiday", "Hindu"]
  locations: string; // e.g., "All"
  states: string; // e.g., "All" or specific states
}

interface CalendarificResponse {
  meta: {
    code: number;
  };
  response: {
    holidays: CalendarificHoliday[];
  };
}

// In-memory cache to avoid hitting rate limits
const cache: Map<string, { data: FestivalEvent[]; timestamp: number }> = new Map();
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetches festivals/holidays for a given year and country
 * 
 * @param year - Year to fetch holidays for
 * @param country - ISO 3166-1 country code (e.g., "IN" for India, "US" for USA)
 * @returns Array of festivals with dates and metadata
 */
export async function fetchFestivalsFromAPI(
  year: number,
  country: string = 'IN'
): Promise<FestivalEvent[]> {
  const cacheKey = `${country}-${year}`;
  
  // Check cache first
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION_MS) {
    console.log(`[FestivalAPI] ✓ Using cached festivals for ${country} ${year}`);
    return cached.data;
  }

  // Get API key from environment
  const apiKey = process.env.CALENDARIFIC_API_KEY;
  
  if (!apiKey) {
    console.warn('[FestivalAPI] ⚠ No API key found, using fallback data');
    return getFallbackFestivals(year, country);
  }

  try {
    console.log(`[FestivalAPI] Fetching festivals from Calendarific API for ${country} ${year}...`);
    
    const url = 'https://calendarific.com/api/v2/holidays';
    const params = {
      api_key: apiKey,
      country: country,
      year: year,
    };

    const response = await axios.get<CalendarificResponse>(url, { params, timeout: 10000 });

    if (response.data.meta.code !== 200) {
      throw new Error(`Calendarific API error: ${response.data.meta.code}`);
    }

    // Transform API response to our FestivalEvent format
    const festivals: FestivalEvent[] = response.data.response.holidays.map((holiday) => {
      return {
        date: holiday.date.iso,
        name: holiday.name,
        category: categorizeFestival(holiday.type),
        relevance: determineRelevance(holiday.type, holiday.states),
      };
    });

    // Filter to only include relevant festivals (high/medium relevance)
    const relevantFestivals = festivals.filter((f) => f.relevance === 'high' || f.relevance === 'medium');

    console.log(`[FestivalAPI] ✓ Fetched ${relevantFestivals.length} festivals (${festivals.length} total)`);

    // Cache the results
    cache.set(cacheKey, { data: relevantFestivals, timestamp: Date.now() });

    return relevantFestivals;
  } catch (error) {
    console.error('[FestivalAPI] ✗ Failed to fetch from API:', error);
    console.log('[FestivalAPI] ⚠ Falling back to hardcoded data');
    
    // Return fallback data on error
    return getFallbackFestivals(year, country);
  }
}

/**
 * Categorize festival based on API type tags
 */
function categorizeFestival(types: string[]): string {
  const typeStr = types.join(' ').toLowerCase();
  
  if (typeStr.includes('national')) return 'national';
  if (typeStr.includes('hindu') || typeStr.includes('muslim') || typeStr.includes('christian') || typeStr.includes('buddhist')) {
    return 'religious';
  }
  if (typeStr.includes('observance')) return 'observance';
  
  return 'cultural';
}

/**
 * Determine relevance based on festival type and coverage
 */
function determineRelevance(types: string[], states: string): 'high' | 'medium' | 'low' {
  const typeStr = types.join(' ').toLowerCase();
  
  // National holidays = high relevance
  if (typeStr.includes('national holiday')) return 'high';
  
  // Major religious festivals = high
  const majorFestivals = ['diwali', 'holi', 'eid', 'christmas', 'republic day', 'independence day'];
  if (majorFestivals.some((festival) => typeStr.toLowerCase().includes(festival))) {
    return 'high';
  }
  
  // All-state observances = medium
  if (states === 'All' || !states) return 'medium';
  
  // Regional festivals = low
  return 'low';
}

/**
 * Fallback festival data when API is unavailable
 * Uses same hardcoded data as before
 */
function getFallbackFestivals(year: number, country: string): FestivalEvent[] {
  if (country !== 'IN') {
    console.warn(`[FestivalAPI] No fallback data for country: ${country}`);
    return [];
  }

  // Major Indian festivals (approximate dates - use API for accuracy)
  return [
    { date: `${year}-01-26`, name: 'Republic Day', category: 'national', relevance: 'high' },
    { date: `${year}-03-08`, name: "International Women's Day", category: 'cultural', relevance: 'high' },
    { date: `${year}-03-14`, name: 'Holi', category: 'religious', relevance: 'high' },
    { date: `${year}-08-15`, name: 'Independence Day', category: 'national', relevance: 'high' },
    { date: `${year}-10-02`, name: 'Gandhi Jayanti', category: 'national', relevance: 'high' },
    { date: `${year}-10-24`, name: 'Diwali', category: 'religious', relevance: 'high' },
    { date: `${year}-12-25`, name: 'Christmas', category: 'religious', relevance: 'high' },
  ];
}

/**
 * Clears the festival cache
 * Useful for testing or forcing refresh
 */
export function clearFestivalCache(): void {
  cache.clear();
  console.log('[FestivalAPI] ✓ Festival cache cleared');
}

/**
 * Gets festivals for a date range using cached or fresh API data
 * 
 * @param startDate - Campaign start date
 * @param endDate - Campaign end date
 * @param country - ISO country code
 * @returns Filtered festivals within date range
 */
export async function getFestivalsForDateRange(
  startDate: Date,
  endDate: Date,
  country: string = 'IN'
): Promise<FestivalEvent[]> {
  const startYear = startDate.getFullYear();
  const endYear = endDate.getFullYear();
  
  const allFestivals: FestivalEvent[] = [];
  
  // Fetch festivals for all years in the range
  for (let year = startYear; year <= endYear; year++) {
    const yearFestivals = await fetchFestivalsFromAPI(year, country);
    allFestivals.push(...yearFestivals);
  }
  
  // Filter to date range
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];
  
  const filtered = allFestivals.filter((festival) => {
    return festival.date >= startDateStr && festival.date <= endDateStr;
  });
  
  console.log(`[FestivalAPI] ✓ Found ${filtered.length} festivals in date range ${startDateStr} to ${endDateStr}`);
  
  return filtered;
}
