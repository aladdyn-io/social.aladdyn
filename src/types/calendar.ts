/**
 * Calendar-specific data contracts
 */

export interface CalendarDayGroup {
  /** YYYY-MM-DD */
  date: string;
  /** Raw SocialPost records from Prisma */
  posts: any[];
}

export interface ManualPostData {
  scheduledDate: Date;
  /** HH:mm */
  scheduledTime: string;
  /** "instagram" | "linkedin" */
  platform: string;
  /** default "photo" */
  contentType?: string;
  /** Maps to SocialPost.topic */
  topic?: string;
  caption?: string;
  hashtags?: string[];
  callToAction?: string;
  imageUrl?: string;
  contentPillar?: string;
  isFestival?: boolean;
  festivalName?: string;
}
