/**
 * Database Module — Prisma edition
 *
 * All reads/writes go to the `social.*` schema via Prisma.
 * The old raw-pg Pool has been removed.
 */

import prisma from '../lib/prisma';
import { PostItem, Strategy, CalendarItem, ContentInput } from '../types/content';

// ============================================================================
// CAMPAIGN FUNCTIONS
// ============================================================================

export async function getCampaignFromDB(campaignId: string): Promise<ContentInput> {
  console.log(`[Database] Fetching campaign: ${campaignId}`);

  const campaign = await prisma.socialCampaign.findUniqueOrThrow({
    where: { id: campaignId },
  });

  console.log('[Database] ✓ Campaign fetched successfully');

  return {
    industry: campaign.industry || '',
    total_days: campaign.totalDays,
    frequency_per_week: campaign.frequencyPerWeek,
    festival_enabled: campaign.festivalEnabled,
    logo_url: campaign.brandLogo || '',
    font_style: 'modern',
    accent_color: campaign.accentColor || '#667eea',
    base_color: campaign.brandColor || '#764ba2',
    services: campaign.services,
    geography: campaign.geography || 'India',
  };
}

/**
 * No-op — campaign creation is done in server.ts via prisma.socialCampaign.create().
 * Kept for backward compatibility with any direct calls.
 */
export async function saveCampaignToDB(campaignId: string, _input: any): Promise<string> {
  return campaignId;
}

// ============================================================================
// POST FUNCTIONS
// ============================================================================

export async function savePostsToDB(
  campaignId: string,
  posts: PostItem[]
): Promise<string[]> {
  console.log(`[Database] Saving ${posts.length} posts for campaign ${campaignId}...`);

  const results = await prisma.$transaction(
    posts.map((post) =>
      prisma.socialPost.create({
        data: {
          campaignId,
          scheduledDate: post.scheduledDate,
          scheduledTime: '10:00',
          timezone: 'Asia/Kolkata',
          platform: 'instagram',
          contentType: 'photo',
          caption: post.caption,
          hashtags: post.hashtags,
          callToAction: post.callToAction,
          imagePrompt: post.detailedImagePrompt,
          imageUrl: post.imageUrl ?? undefined,
          imageGenerated: !!post.imageUrl,
          imageModel: post.metadata.imageModel ?? undefined,
          contentPillar: post.metadata.contentPillar ?? undefined,
          topic: post.metadata.topic,
          isFestival: !!post.metadata.festival,
          festivalName: post.metadata.festival ?? undefined,
          status: 'DRAFT',
        },
      })
    )
  );

  const ids = results.map((p) => p.id);
  console.log(`[Database] ✓ Saved ${ids.length} posts successfully`);
  return ids;
}

export async function getPostsByCampaign(campaignId: string): Promise<any[]> {
  console.log(`[Database] Fetching posts for campaign: ${campaignId}`);

  const posts = await prisma.socialPost.findMany({
    where: { campaignId },
    orderBy: { scheduledDate: 'asc' },
  });

  console.log(`[Database] ✓ Found ${posts.length} posts`);
  return posts;
}

export async function getPostsByDate(campaignId: string, date: string): Promise<any[]> {
  console.log(`[Database] Fetching posts for ${date} in campaign ${campaignId}`);

  const start = new Date(date);
  const end = new Date(date);
  end.setDate(end.getDate() + 1);

  const posts = await prisma.socialPost.findMany({
    where: { campaignId, scheduledDate: { gte: start, lt: end } },
    orderBy: { scheduledDate: 'asc' },
  });

  console.log(`[Database] ✓ Found ${posts.length} posts for ${date}`);
  return posts;
}

export async function getPostById(postId: string): Promise<any | null> {
  console.log(`[Database] Fetching post: ${postId}`);

  const post = await prisma.socialPost.findUnique({ where: { id: postId } });

  if (!post) {
    console.log(`[Database] Post not found: ${postId}`);
    return null;
  }

  console.log(`[Database] ✓ Post fetched successfully`);
  return post;
}

export async function updatePost(
  postId: string,
  updates: Record<string, any>
): Promise<any> {
  console.log(`[Database] Updating post: ${postId}`);

  // Map snake_case and camelCase keys to Prisma field names
  const data: any = {};

  if (updates.caption !== undefined) data.caption = updates.caption;
  if (updates.hashtags !== undefined) data.hashtags = updates.hashtags;
  if (updates.image_url !== undefined) data.imageUrl = updates.image_url;
  if (updates.imageUrl !== undefined) data.imageUrl = updates.imageUrl;
  if (updates.image_prompt !== undefined) data.imagePrompt = updates.image_prompt;
  if (updates.imagePrompt !== undefined) data.imagePrompt = updates.imagePrompt;
  if (updates.image_model !== undefined) data.imageModel = updates.image_model;
  if (updates.imageModel !== undefined) data.imageModel = updates.imageModel;
  if (updates.call_to_action !== undefined) data.callToAction = updates.call_to_action;
  if (updates.callToAction !== undefined) data.callToAction = updates.callToAction;
  if (updates.status !== undefined) {
    data.status = (updates.status as string).toUpperCase();
  }
  if (updates.approvedAt !== undefined) data.approvedAt = updates.approvedAt;
  if (updates.approved_at !== undefined) data.approvedAt = updates.approved_at;
  if (updates.publishedAt !== undefined) data.publishedAt = updates.publishedAt;
  if (updates.published_at !== undefined) data.publishedAt = updates.published_at;

  if (Object.keys(data).length === 0) {
    throw new Error('No valid fields to update');
  }

  const updated = await prisma.socialPost.update({ where: { id: postId }, data });

  console.log(`[Database] ✓ Post updated successfully`);
  return updated;
}

export async function deletePost(postId: string): Promise<void> {
  console.log(`[Database] Deleting post: ${postId}`);

  await prisma.socialPost.delete({ where: { id: postId } });

  console.log(`[Database] ✓ Post deleted successfully`);
}

export async function updatePostImage(
  postId: string,
  imageUrl: string,
  imageModel: string
): Promise<void> {
  console.log(`[Database] Updating post ${postId} with generated image`);

  await prisma.socialPost.update({
    where: { id: postId },
    data: { imageUrl, imageModel, imageGenerated: true },
  });

  console.log(`[Database] ✓ Post image updated successfully`);
}

// ============================================================================
// STRATEGY FUNCTIONS
// ============================================================================

export async function saveStrategyToDB(
  campaignId: string,
  strategy: Strategy
): Promise<string> {
  console.log(`[Database] Saving strategy for campaign: ${campaignId}`);

  const saved = await prisma.socialStrategy.create({
    data: {
      campaignId,
      contentPillars: strategy.content_pillars,
      tone: strategy.tone,
      ctaStyle: strategy.cta_style,
      contentMix: strategy.content_mix as any,
      campaignPhases: strategy.campaign_phases
        ? (strategy.campaign_phases as any)
        : undefined,
      modelUsed: process.env.LLM_MODEL || 'gpt-4o-mini',
    },
  });

  console.log(`[Database] ✓ Strategy saved: ${saved.id}`);
  return saved.id;
}

export async function getStrategyFromDB(strategyId: string): Promise<Strategy> {
  console.log(`[Database] Fetching strategy: ${strategyId}`);

  const row = await prisma.socialStrategy.findUniqueOrThrow({ where: { id: strategyId } });
  const mix = row.contentMix as any;

  console.log(`[Database] ✓ Strategy found`);
  return {
    strategy_id: row.id,
    content_pillars: row.contentPillars,
    tone: row.tone || 'warm and engaging',
    cta_style: row.ctaStyle || 'inviting',
    content_mix: {
      education: mix?.education ?? 30,
      trust: mix?.trust ?? 50,
      promotion: mix?.promotion ?? 20,
    },
    campaign_phases: row.campaignPhases as any,
  };
}

export async function getStrategyByCampaignId(campaignId: string): Promise<Strategy | null> {
  const row = await prisma.socialStrategy.findUnique({ where: { campaignId } });
  if (!row) return null;

  const mix = row.contentMix as any;
  return {
    strategy_id: row.id,
    content_pillars: row.contentPillars,
    tone: row.tone || 'warm and engaging',
    cta_style: row.ctaStyle || 'inviting',
    content_mix: {
      education: mix?.education ?? 30,
      trust: mix?.trust ?? 50,
      promotion: mix?.promotion ?? 20,
    },
    campaign_phases: row.campaignPhases as any,
  };
}

// ============================================================================
// CALENDAR FUNCTIONS
// Calendar entries are not stored separately — schedule lives on SocialPost.
// These are kept so the pipeline import doesn't break.
// ============================================================================

export async function saveCalendarToDB(
  _campaignId: string,
  _strategyId: string,
  calendar: CalendarItem[]
): Promise<string[]> {
  // Calendar is ephemeral — SocialPost is the source of truth for scheduling.
  return calendar.map((_, i) => `cal-${i}`);
}

export async function getCalendarEntryById(_entryId: string): Promise<any> {
  throw new Error('Calendar entries are no longer stored separately');
}

export async function getCalendarByCampaignId(campaignId: string): Promise<any[]> {
  const posts = await prisma.socialPost.findMany({
    where: { campaignId },
    orderBy: { scheduledDate: 'asc' },
    select: {
      id: true,
      campaignId: true,
      scheduledDate: true,
      contentPillar: true,
      topic: true,
      contentType: true,
      isFestival: true,
      festivalName: true,
    },
  });

  return posts.map((p, i) => ({
    entry_id: p.id,
    campaign_id: p.campaignId,
    scheduled_date: p.scheduledDate,
    day_number: i + 1,
    pillar: p.contentPillar,
    topic: p.topic,
    content_type: p.contentType,
    is_festival: p.isFestival,
    festival_name: p.festivalName,
    status: 'planned',
  }));
}

export async function getExistingTopicsForCampaign(campaignId: string): Promise<string[]> {
  const posts = await prisma.socialPost.findMany({
    where: { campaignId },
    select: { topic: true },
  });
  return posts.map((p) => p.topic).filter(Boolean) as string[];
}

export async function isTopicDuplicate(
  campaignId: string,
  topic: string
): Promise<boolean> {
  const count = await prisma.socialPost.count({
    where: { campaignId, topic: { equals: topic, mode: 'insensitive' } },
  });
  return count > 0;
}

export async function closeDatabase(): Promise<void> {
  await prisma.$disconnect();
  console.log('[Database] Prisma client disconnected');
}
