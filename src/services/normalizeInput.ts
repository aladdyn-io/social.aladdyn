/**
 * Input Normalization Service
 * 
 * Validates and normalizes raw database input into a clean format.
 * This is RULE-BASED logic (no AI).
 */

import { ContentInput } from '../types/content';

/**
 * NormalizedInput - Validated and transformed input
 * 
 * Internal type used after normalization.
 * Contains computed fields and sanitized data.
 */
export interface NormalizedInput {
  // Original validated fields
  industry: string;
  total_days: number;
  frequency_per_week: number;
  festival_enabled: boolean;
  logo_url: string;
  font_style: string;
  accent_color: string;
  base_color: string;
  services: string[];
  geography: string;

  // Computed fields
  posting_days: number;
  brand_stage: 'new' | 'growing';
  trust_weight: number;
  education_weight: number;
  promo_weight: number;
  platform: string;
}

/**
 * Normalizes and validates content input
 * 
 * WHY: Ensures all downstream logic works with clean, validated data
 * WHY: Computes derived fields once instead of repeatedly
 * WHY: Fails early to avoid wasting resources on invalid input
 * 
 * @param input - Raw input from database
 * @returns Validated and normalized input
 * @throws Error if validation fails
 */
export function normalizeInput(input: ContentInput): NormalizedInput {
  // ========================================================================
  // VALIDATE REQUIRED FIELDS
  // WHY: Fail fast if critical data is missing
  // ========================================================================

  if (!input.industry || input.industry.trim().length === 0) {
    throw new Error('Validation failed: industry is required and cannot be empty');
  }

  if (!input.total_days || input.total_days <= 0) {
    throw new Error('Validation failed: total_days must be a positive number');
  }

  if (!input.frequency_per_week || input.frequency_per_week <= 0 || input.frequency_per_week > 7) {
    throw new Error('Validation failed: frequency_per_week must be between 1 and 7');
  }

  if (!input.services || input.services.length === 0) {
    throw new Error('Validation failed: services array cannot be empty');
  }

  if (!input.geography || input.geography.trim().length === 0) {
    throw new Error('Validation failed: geography is required and cannot be empty');
  }

  // ========================================================================
  // CALCULATE POSTING_DAYS
  // WHY: Total number of posts needed based on duration and frequency
  // ========================================================================

  const posting_days = Math.floor((input.frequency_per_week / 7) * input.total_days);

  // ========================================================================
  // DETERMINE BRAND_STAGE
  // WHY: New brands need different content strategy than established ones
  // ========================================================================

  const brand_stage: 'new' | 'growing' = input.total_days <= 30 ? 'new' : 'growing';

  // ========================================================================
  // ASSIGN CONTENT WEIGHTS
  // WHY: Different industries need different content mix
  // WHY: Trust-sensitive industries need more educational content
  // ========================================================================

  const industryLower = input.industry.trim().toLowerCase();
  
  // Trust-sensitive industries need higher trust-building content
  const trustSensitiveIndustries = ['fintech', 'health', 'legal'];
  const isTrustSensitive = trustSensitiveIndustries.some(
    industry => industryLower.includes(industry)
  );

  const trust_weight = isTrustSensitive ? 0.5 : 0.3;
  const promo_weight = 0.2;
  const education_weight = 1 - trust_weight - promo_weight;

  // ========================================================================
  // SET DEFAULT PLATFORM
  // WHY: Instagram is default for social media content
  // ========================================================================

  const platform = 'instagram';

  // ========================================================================
  // RETURN NORMALIZED INPUT
  // WHY: Create new object (no mutation) with all computed fields
  // ========================================================================

  return {
    industry: input.industry.trim(),
    total_days: input.total_days,
    frequency_per_week: input.frequency_per_week,
    festival_enabled: input.festival_enabled ?? false,
    logo_url: input.logo_url,
    font_style: input.font_style,
    accent_color: input.accent_color,
    base_color: input.base_color,
    services: input.services.map(s => s.trim()).filter(s => s.length > 0),
    geography: input.geography.trim(),
    posting_days,
    brand_stage,
    trust_weight,
    education_weight,
    promo_weight,
    platform,
  };
}
