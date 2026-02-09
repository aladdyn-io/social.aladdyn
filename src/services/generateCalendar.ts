/**
 * Content Calendar Generation Service
 * 
 * Creates a posting schedule with even distribution and festival integration.
 * Now uses AI-based topic generation for contextual, unique topics.
 */

import { CalendarItem, Strategy, FestivalEvent } from '../types/content';
import { NormalizedInput } from './normalizeInput';
import { generateTopicsBatch, buildTopicRequests } from './generateTopics';

/**
 * Generates content calendar with AI-powered topic generation
 * 
 * Algorithm:
 * 1. Calculate posting dates (evenly distributed)
 * 2. Assign content pillars based on strategy content_mix
 * 3. Shuffle pillars to avoid consecutive repeats
 * 4. Overlay festival posts (capped at 20% of total)
 * 5. Generate AI-based topics for each calendar item
 * 
 * WHY: Deterministic scheduling ensures predictable content flow
 * WHY: Even spacing looks professional
 * WHY: Festival overlay keeps content timely and relevant
 * WHY: AI topics are contextual, campaign-aware, and unique
 * 
 * @param input - Normalized campaign input
 * @param strategy - Generated content strategy
 * @param festivals - Array of festival events to consider
 * @param campaignId - Optional campaign ID for duplicate detection
 * @returns Array of scheduled calendar items with AI-generated topics
 */
export async function generateCalendar(
  input: NormalizedInput,
  strategy: Strategy,
  festivals: FestivalEvent[],
  campaignId?: string
): Promise<CalendarItem[]> {
  // ========================================================================
  // STEP 1: CALCULATE POSTING DATES
  // WHY: Posts must be evenly distributed across the campaign period
  // ========================================================================
  
  const postingDates = calculatePostingDates(input);

  // ========================================================================
  // STEP 2: ASSIGN PILLARS BASED ON CONTENT_MIX
  // WHY: Respect strategy percentages for balanced content
  // ========================================================================
  
  const pillarAssignments = assignPillars(
    input.posting_days,
    strategy.content_mix,
    strategy.content_pillars
  );

  // ========================================================================
  // STEP 3: IDENTIFY FESTIVAL DATES (CAPPED AT 20%)
  // WHY: Festivals boost engagement but shouldn't dominate content
  // ========================================================================
  
  const festivalDates = identifyFestivalDates(
    postingDates,
    festivals,
    input.posting_days
  );

  // ========================================================================
  // STEP 4: BUILD CALENDAR ITEMS (without topics first)
  // WHY: Combine dates, pillars, and festivals into calendar structure
  // ========================================================================
  
  const calendarWithoutTopics: Array<{
    date: string;
    pillar: string;
    content_type: string;
    is_festival: boolean;
    festival_name?: string;
    day_number: number;
  }> = [];

  for (let i = 0; i < postingDates.length; i++) {
    const date = postingDates[i];
    const dateString = formatDate(date);
    const festivalInfo = festivalDates.get(dateString);
    
    if (festivalInfo) {
      // Festival post
      calendarWithoutTopics.push({
        date: dateString,
        pillar: 'Festival / Brand Connect',
        content_type: 'image',
        is_festival: true,
        festival_name: festivalInfo.name,
        day_number: i + 1,
      });
    } else {
      // Regular post - determine content type from content_mix
      const pillar = pillarAssignments[i];
      const contentType = determineContentType(pillar, strategy);
      
      calendarWithoutTopics.push({
        date: dateString,
        pillar,
        content_type: contentType,
        is_festival: false,
        day_number: i + 1,
      });
    }
  }

  // ========================================================================
  // STEP 5: GENERATE AI TOPICS FOR ALL CALENDAR ITEMS
  // WHY: AI generates contextual, campaign-aware, unique topics
  // ========================================================================
  
  console.log('[generateCalendar] Generating AI topics for calendar...');
  
  const topicRequests = buildTopicRequests(
    calendarWithoutTopics,
    input,
    strategy
  );

  const topics = await generateTopicsBatch(input, strategy, topicRequests, campaignId);

  // ========================================================================
  // STEP 6: COMBINE CALENDAR WITH GENERATED TOPICS
  // ========================================================================
  
  const calendar: CalendarItem[] = calendarWithoutTopics.map((entry, index) => ({
    date: entry.date,
    pillar: entry.pillar,
    topic: topics[index],
    content_type: entry.content_type as 'image',
    is_festival: entry.is_festival,
    festival_name: entry.festival_name,
  }));

  console.log(`[generateCalendar] ✓ Generated calendar with ${calendar.length} entries`);
  return calendar;
}

/**
 * Calculates evenly distributed posting dates
 * 
 * WHY: Even spacing prevents content bunching and maintains consistency
 */
function calculatePostingDates(input: NormalizedInput): Date[] {
  const dates: Date[] = [];
  const startDate = new Date();
  
  // Calculate days between posts
  // WHY: frequency_per_week determines posting cadence
  const daysInterval = Math.floor(input.total_days / input.posting_days);
  
  for (let i = 0; i < input.posting_days; i++) {
    const postDate = new Date(startDate);
    postDate.setDate(startDate.getDate() + (i * daysInterval));
    dates.push(postDate);
  }

  return dates;
}

/**
 * Assigns content pillars to posts based on content_mix percentages
 * 
 * WHY: Strategy defines ideal content distribution
 * WHY: Shuffling avoids consecutive same-pillar posts
 */
function assignPillars(
  totalPosts: number,
  contentMix: { education: number; trust: number; promotion: number },
  contentPillars: string[]
): string[] {
  const assignments: string[] = [];
  
  // Map content_mix types to pillars
  // WHY: We need to map percentages to actual pillar names
  const pillarTypes = {
    education: contentPillars[0] || 'Educational Content',
    trust: contentPillars[1] || 'Trust Building',
    promotion: contentPillars[2] || 'Promotional Content',
  };

  // Calculate posts per type
  const educationCount = Math.round((contentMix.education / 100) * totalPosts);
  const trustCount = Math.round((contentMix.trust / 100) * totalPosts);
  const promotionCount = totalPosts - educationCount - trustCount; // Remainder

  // Create pillar array
  for (let i = 0; i < educationCount; i++) assignments.push(pillarTypes.education);
  for (let i = 0; i < trustCount; i++) assignments.push(pillarTypes.trust);
  for (let i = 0; i < promotionCount; i++) assignments.push(pillarTypes.promotion);

  // Shuffle to avoid consecutive same pillars
  // WHY: Better content variety for audience
  return shuffleAvoidingConsecutive(assignments);
}

/**
 * Identifies which posting dates should be festival posts
 * 
 * WHY: Festival posts must align with actual festival dates
 * WHY: 20% cap prevents festival overload
 */
function identifyFestivalDates(
  postingDates: Date[],
  festivals: FestivalEvent[],
  totalPosts: number
): Map<string, FestivalEvent> {
  const festivalMap = new Map<string, FestivalEvent>();
  const maxFestivalPosts = Math.ceil(totalPosts * 0.2); // 20% cap
  
  // Sort festivals by relevance
  const sortedFestivals = festivals
    .filter(f => f.relevance === 'high' || f.relevance === 'medium')
    .sort((a, b) => {
      const relevanceScore = { high: 3, medium: 2, low: 1 };
      return relevanceScore[b.relevance] - relevanceScore[a.relevance];
    });

  let festivalCount = 0;

  for (const festival of sortedFestivals) {
    if (festivalCount >= maxFestivalPosts) break;

    const festivalDate = new Date(festival.date);
    
    // Find closest posting date to this festival
    // WHY: Post should be near the festival date, not necessarily exact
    const closestDate = findClosestDate(postingDates, festivalDate);
    
    if (closestDate) {
      const dateString = formatDate(closestDate);
      
      // Avoid duplicate festival assignments
      if (!festivalMap.has(dateString)) {
        festivalMap.set(dateString, festival);
        festivalCount++;
      }
    }
  }

  return festivalMap;
}

/**
 * Finds the closest posting date to a festival date
 * 
 * WHY: Festival post should be near the actual festival
 */
function findClosestDate(postingDates: Date[], targetDate: Date): Date | null {
  if (postingDates.length === 0) return null;

  let closest = postingDates[0];
  let minDiff = Math.abs(postingDates[0].getTime() - targetDate.getTime());

  for (const date of postingDates) {
    const diff = Math.abs(date.getTime() - targetDate.getTime());
    if (diff < minDiff) {
      minDiff = diff;
      closest = date;
    }
  }

  // Only return if within 3 days of festival
  // WHY: Post too far from festival loses relevance
  const daysDiff = minDiff / (1000 * 60 * 60 * 24);
  return daysDiff <= 3 ? closest : null;
}

/**
 * Shuffles array while avoiding consecutive duplicates
 * 
 * WHY: Better content variety without predictable patterns
 */
function shuffleAvoidingConsecutive(arr: string[]): string[] {
  const shuffled = [...arr];
  
  // Fisher-Yates shuffle
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Fix consecutive duplicates
  // WHY: Consecutive same pillars look repetitive
  for (let i = 1; i < shuffled.length; i++) {
    if (shuffled[i] === shuffled[i - 1]) {
      // Find a different element to swap with
      for (let j = i + 1; j < shuffled.length; j++) {
        if (shuffled[j] !== shuffled[i - 1] && shuffled[j] !== shuffled[i + 1]) {
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          break;
        }
      }
    }
  }

  return shuffled;
}

/**
 * Determines content type from pillar based on strategy
 * 
 * WHY: Maps pillars to education/trust/promotion categories
 */
function determineContentType(pillar: string, strategy: Strategy): string {
  // Simple heuristic: rotate through types based on content_mix
  // In practice, this could be more sophisticated
  
  const mix = strategy.content_mix;
  const random = Math.random() * 100;
  
  if (random < mix.education) {
    return 'education';
  } else if (random < mix.education + mix.trust) {
    return 'trust';
  } else {
    return 'promotion';
  }
}

/**
 * Formats date to ISO string (YYYY-MM-DD)
 * 
 * WHY: Consistent date format for all calendar items
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}
