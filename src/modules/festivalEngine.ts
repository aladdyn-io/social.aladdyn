/**
 * Festival Engine Module
 * 
 * Responsibility: Fetch relevant Indian festivals for the campaign period
 * NO AI - Pure rule-based festival selection
 * 
 * WHY: Festival dates are deterministic and don't need AI
 */

import { Festival } from '../types';

/**
 * Gets festivals within the specified date range for India
 * 
 * Rules:
 * - Only returns festivals that fall within start and end dates
 * - Filters by relevance (high/medium only for now)
 * - Returns sorted by date
 * 
 * TODO: In production, this should read from a database or API
 * For V1, using a hardcoded list of major Indian festivals
 * 
 * @param startDate - Campaign start date
 * @param endDate - Campaign end date
 * @param geography - Geography filter (currently only "India")
 * @returns Array of relevant festivals
 */
export async function getFestivalsForPeriod(
  startDate: Date,
  endDate: Date,
  geography: string
): Promise<Festival[]> {
  console.log('[FestivalEngine] Fetching festivals for date range...');

  if (geography !== 'India') {
    console.log('[FestivalEngine] Non-India geography not supported yet');
    return [];
  }

  // ========================================================================
  // FESTIVAL DATABASE
  // TODO: Move this to PostgreSQL or external API
  // WHY: Hardcoded for V1, but should be data-driven for production
  // ========================================================================
  
  const allFestivals = getIndianFestivals2026();

  // ========================================================================
  // FILTER BY DATE RANGE
  // WHY: Only include festivals that fall within campaign period
  // ========================================================================
  
  const relevantFestivals = allFestivals.filter((festival) => {
    return festival.date >= startDate && festival.date <= endDate;
  });

  // Sort by date
  relevantFestivals.sort((a, b) => a.date.getTime() - b.date.getTime());

  console.log(`[FestivalEngine] ✓ Found ${relevantFestivals.length} festivals`);
  return relevantFestivals;
}

/**
 * Returns major Indian festivals for 2026
 * 
 * TODO: Replace with database or API call
 * TODO: Support dynamic years
 * 
 * WHY: Hardcoded for V1 to unblock development
 */
function getIndianFestivals2026(): Festival[] {
  const year = 2026;
  
  return [
    // January
    {
      name: 'Republic Day',
      date: new Date(year, 0, 26), // Jan 26
      category: 'national',
      relevance: 'high',
    },
    // February
    {
      name: 'Maha Shivaratri',
      date: new Date(year, 1, 16), // Feb 16
      category: 'religious',
      relevance: 'high',
    },
    // March
    {
      name: 'Holi',
      date: new Date(year, 2, 14), // Mar 14
      category: 'religious',
      relevance: 'high',
    },
    {
      name: "International Women's Day",
      date: new Date(year, 2, 8), // Mar 8
      category: 'cultural',
      relevance: 'high',
    },
    // April
    {
      name: 'Ram Navami',
      date: new Date(year, 3, 2), // Apr 2
      category: 'religious',
      relevance: 'medium',
    },
    {
      name: 'Mahavir Jayanti',
      date: new Date(year, 3, 3), // Apr 3
      category: 'religious',
      relevance: 'medium',
    },
    {
      name: 'Good Friday',
      date: new Date(year, 3, 10), // Apr 10
      category: 'religious',
      relevance: 'medium',
    },
    // May
    {
      name: 'Eid ul-Fitr',
      date: new Date(year, 4, 1), // May 1 (approximate)
      category: 'religious',
      relevance: 'high',
    },
    {
      name: 'Buddha Purnima',
      date: new Date(year, 4, 12), // May 12
      category: 'religious',
      relevance: 'medium',
    },
    // June - no major festivals
    // July
    {
      name: 'Eid ul-Adha',
      date: new Date(year, 6, 8), // Jul 8 (approximate)
      category: 'religious',
      relevance: 'high',
    },
    // August
    {
      name: 'Independence Day',
      date: new Date(year, 7, 15), // Aug 15
      category: 'national',
      relevance: 'high',
    },
    {
      name: 'Janmashtami',
      date: new Date(year, 7, 25), // Aug 25
      category: 'religious',
      relevance: 'high',
    },
    // September
    {
      name: 'Ganesh Chaturthi',
      date: new Date(year, 8, 5), // Sep 5
      category: 'religious',
      relevance: 'high',
    },
    // October
    {
      name: 'Gandhi Jayanti',
      date: new Date(year, 9, 2), // Oct 2
      category: 'national',
      relevance: 'medium',
    },
    {
      name: 'Dussehra',
      date: new Date(year, 9, 12), // Oct 12
      category: 'religious',
      relevance: 'high',
    },
    {
      name: 'Diwali',
      date: new Date(year, 9, 31), // Oct 31
      category: 'religious',
      relevance: 'high',
    },
    // November
    {
      name: 'Bhai Dooj',
      date: new Date(year, 10, 2), // Nov 2
      category: 'religious',
      relevance: 'medium',
    },
    {
      name: 'Guru Nanak Jayanti',
      date: new Date(year, 10, 27), // Nov 27
      category: 'religious',
      relevance: 'medium',
    },
    // December
    {
      name: 'Christmas',
      date: new Date(year, 11, 25), // Dec 25
      category: 'religious',
      relevance: 'high',
    },
  ];
}
