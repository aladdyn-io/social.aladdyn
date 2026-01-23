/**
 * Calendar Generator Module
 * 
 * Responsibility: Generate content calendar with proper spacing and festival posts
 * NO AI - Pure rule-based scheduling
 * 
 * WHY: Calendar scheduling should be deterministic and predictable
 */

import { v4 as uuidv4 } from 'uuid';
import {
  NormalizedInput,
  ContentStrategy,
  Festival,
  ContentCalendar,
  CalendarEntry,
  ContentPillar,
} from '../types';

/**
 * Generates content calendar based on rules and festivals
 * 
 * Algorithm:
 * 1. Reserve slots for festivals (if enabled)
 * 2. Distribute remaining posts across content pillars based on percentages
 * 3. Space posts evenly according to frequency_per_week
 * 4. Generate unique IDs for each entry
 * 
 * @param input - Normalized campaign input
 * @param strategy - Generated content strategy
 * @param festivals - Relevant festivals for the period
 * @returns Complete content calendar
 */
export function generateCalendar(
  input: NormalizedInput,
  strategy: ContentStrategy,
  festivals: Festival[]
): ContentCalendar {
  console.log('[CalendarGenerator] Building calendar...');

  const entries: CalendarEntry[] = [];
  const pillarDistribution: Record<string, number> = {};

  // ========================================================================
  // STEP 1: Add festival posts
  // WHY: Festivals are date-specific and must be posted on exact dates
  // ========================================================================
  
  const festivalDates = new Set<string>();
  
  if (input.festivalEnabled) {
    for (const festival of festivals) {
      // Only include high-relevance festivals (can be made configurable)
      if (festival.relevance === 'high') {
        entries.push({
          entryId: uuidv4(),
          scheduledDate: festival.date,
          postType: 'festival',
          festival,
          themeHint: `Create a post celebrating ${festival.name}`,
        });
        
        festivalDates.add(festival.date.toISOString().split('T')[0]);
      }
    }
  }

  console.log(`[CalendarGenerator] Added ${entries.length} festival posts`);

  // ========================================================================
  // STEP 2: Calculate regular post slots
  // WHY: We need to fill remaining posts after reserving festival slots
  // ========================================================================
  
  const regularPostsNeeded = input.totalPostsRequired - entries.length;
  
  if (regularPostsNeeded <= 0) {
    console.log('[CalendarGenerator] All slots filled by festivals');
    return buildCalendarResponse(entries, pillarDistribution);
  }

  // ========================================================================
  // STEP 3: Generate posting dates (evenly spaced)
  // WHY: Even spacing looks more professional than random dates
  // ========================================================================
  
  const postingDates = generatePostingDates(
    input.startDate,
    input.endDate,
    input.frequencyPerWeek,
    regularPostsNeeded,
    festivalDates
  );

  // ========================================================================
  // STEP 4: Distribute posts across content pillars
  // WHY: Follow the strategy percentages to maintain balanced content
  // ========================================================================
  
  const pillarAssignments = distributePillarAssignments(
    strategy.contentPillars,
    regularPostsNeeded
  );

  // ========================================================================
  // STEP 5: Create calendar entries for regular posts
  // ========================================================================
  
  for (let i = 0; i < postingDates.length; i++) {
    const pillar = pillarAssignments[i];
    
    entries.push({
      entryId: uuidv4(),
      scheduledDate: postingDates[i],
      postType: 'regular',
      contentPillar: pillar,
      themeHint: `Create a post about ${pillar.name}: ${pillar.description}`,
    });

    // Track distribution
    pillarDistribution[pillar.name] = (pillarDistribution[pillar.name] || 0) + 1;
  }

  // Sort all entries by date
  entries.sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime());

  console.log('[CalendarGenerator] ✓ Calendar generated successfully');
  return buildCalendarResponse(entries, pillarDistribution);
}

/**
 * Generates evenly-spaced posting dates
 * 
 * WHY: Even spacing prevents bunching and maintains consistent presence
 */
function generatePostingDates(
  startDate: Date,
  endDate: Date,
  frequencyPerWeek: number,
  totalPosts: number,
  excludeDates: Set<string>
): Date[] {
  const dates: Date[] = [];
  const daysBetweenPosts = Math.floor(7 / frequencyPerWeek);
  
  let currentDate = new Date(startDate);
  
  while (dates.length < totalPosts && currentDate <= endDate) {
    const dateString = currentDate.toISOString().split('T')[0];
    
    // Skip if this date is already taken by a festival
    if (!excludeDates.has(dateString)) {
      dates.push(new Date(currentDate));
    }
    
    // Move to next posting date
    currentDate.setDate(currentDate.getDate() + daysBetweenPosts);
  }

  // If we didn't get enough dates (edge case), fill remaining with next available dates
  currentDate = new Date(startDate);
  while (dates.length < totalPosts && currentDate <= endDate) {
    const dateString = currentDate.toISOString().split('T')[0];
    if (!excludeDates.has(dateString) && !dates.some((d) => d.toISOString().split('T')[0] === dateString)) {
      dates.push(new Date(currentDate));
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return dates.sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Distributes posts across content pillars based on percentages
 * 
 * WHY: Ensures content strategy is followed accurately
 */
function distributePillarAssignments(
  pillars: ContentPillar[],
  totalPosts: number
): ContentPillar[] {
  const assignments: ContentPillar[] = [];
  
  // Calculate exact count for each pillar
  for (const pillar of pillars) {
    const count = Math.round((pillar.percentage / 100) * totalPosts);
    for (let i = 0; i < count; i++) {
      assignments.push(pillar);
    }
  }

  // Handle rounding errors - fill remaining slots with first pillar
  while (assignments.length < totalPosts) {
    assignments.push(pillars[0]);
  }

  // Shuffle to avoid all posts of same pillar being consecutive
  // WHY: More natural-looking distribution
  return shuffleArray(assignments);
}

/**
 * Fisher-Yates shuffle
 * WHY: Randomizes pillar order for more natural distribution
 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Builds the final calendar response with summary
 */
function buildCalendarResponse(
  entries: CalendarEntry[],
  pillarDistribution: Record<string, number>
): ContentCalendar {
  const festivalPosts = entries.filter((e) => e.postType === 'festival').length;
  
  return {
    entries,
    summary: {
      totalPosts: entries.length,
      regularPosts: entries.length - festivalPosts,
      festivalPosts,
      distribution: pillarDistribution,
    },
  };
}
