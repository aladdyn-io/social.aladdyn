/**
 * Post Assembly Service
 * 
 * Assembles final PostItem objects from generated content.
 * 
 * WHY: Centralized post assembly logic keeps pipeline clean
 * WHY: Single source of truth for PostItem structure
 */

import { PostItem, CalendarItem } from '../types/content';

/**
 * Assembles a complete PostItem from its components
 * 
 * WHY: Combines image URL, caption, and calendar data into final output
 * WHY: Adds metadata for analytics and debugging
 * 
 * @param imageUrl - Public URL to uploaded image
 * @param caption - Generated caption text
 * @param calendarItem - Calendar entry this post is for
 * @param imagePrompt - Prompt used for image generation
 * @param imageModel - Model used for image generation
 * @returns Complete PostItem ready for publishing
 */
export function assemblePost(
  imageUrl: string,
  caption: string,
  calendarItem: CalendarItem,
  imagePrompt: string,
  imageModel: string
): PostItem {
  // Generate unique entry ID
  // WHY: Links post to calendar item for tracking
  const entryId = `post-${calendarItem.date.replace(/-/g, '')}`;

  // Parse scheduled date
  // WHY: Convert ISO string to Date object for consistency
  const scheduledDate = new Date(calendarItem.date);

  // Generate hashtags based on pillar and industry
  // WHY: Basic hashtag strategy for V1, can be enhanced later
  const hashtags = generateHashtags(calendarItem);

  // Determine CTA
  // WHY: Festival posts might have different CTAs than regular posts
  const callToAction = calendarItem.is_festival
    ? 'Join us in celebrating!'
    : 'Learn more about our services';

  return {
    entryId,
    scheduledDate,
    caption,
    hashtags,
    callToAction,
    imageUrl,
    metadata: {
      contentPillar: calendarItem.is_festival ? undefined : calendarItem.pillar,
      festival: calendarItem.festival_name,
      generatedAt: new Date(),
      imagePrompt,
      imageModel,
    },
  };
}

/**
 * Generates hashtags for a calendar item
 * 
 * WHY: Basic hashtag strategy based on content type
 * TODO: In future, generate hashtags using AI or strategy-based logic
 */
function generateHashtags(calendarItem: CalendarItem): string[] {
  const hashtags: string[] = [];

  if (calendarItem.is_festival && calendarItem.festival_name) {
    // Festival-specific hashtags
    // WHY: Festival posts need relevant trending hashtags
    const festivalTag = calendarItem.festival_name.replace(/\s+/g, '');
    hashtags.push(`#${festivalTag}`);
    hashtags.push('#Celebration');
    hashtags.push('#IndiaFestival');
  } else {
    // Regular content hashtags
    // WHY: Generic but relevant hashtags for business content
    const pillarTag = calendarItem.pillar.replace(/\s+/g, '');
    hashtags.push(`#${pillarTag}`);
    hashtags.push('#Business');
    hashtags.push('#Growth');
  }

  // Add platform hashtag
  hashtags.push('#Instagram');

  return hashtags;
}
