/**
 * Input Normalizer Module
 * 
 * Responsibility: Validate and normalize raw database input
 * NO AI - Pure rule-based validation and transformation
 * 
 * WHY: Fail early if input is malformed or missing required fields
 */

import { DatabaseInput, NormalizedInput, ValidationError } from '../types';

/**
 * Normalizes and validates database input
 * 
 * Rules:
 * - All required fields must be present
 * - Numbers must be positive
 * - Colors must be valid hex codes
 * - Services array must not be empty
 * - Computes total posts required based on frequency and duration
 * 
 * @param dbInput - Raw input from database
 * @returns Validated and normalized input
 * @throws ValidationError if validation fails
 */
export function normalizeInput(dbInput: DatabaseInput): NormalizedInput {
  console.log('[InputNormalizer] Starting validation...');

  // ============================================================================
  // VALIDATION: Check required fields
  // ============================================================================
  
  if (!dbInput.campaign_id) {
    throw new ValidationError('campaign_id is required', 'campaign_id');
  }

  if (!dbInput.industry || dbInput.industry.trim().length === 0) {
    throw new ValidationError('industry is required', 'industry');
  }

  if (!dbInput.total_days || dbInput.total_days <= 0) {
    throw new ValidationError('total_days must be positive', 'total_days');
  }

  if (!dbInput.frequency_per_week || dbInput.frequency_per_week <= 0) {
    throw new ValidationError('frequency_per_week must be positive', 'frequency_per_week');
  }

  if (dbInput.frequency_per_week > 7) {
    throw new ValidationError('frequency_per_week cannot exceed 7', 'frequency_per_week');
  }

  if (!dbInput.services || dbInput.services.length === 0) {
    throw new ValidationError('services array cannot be empty', 'services');
  }

  // Validate branding fields
  if (!dbInput.logo_url || !isValidUrl(dbInput.logo_url)) {
    throw new ValidationError('logo_url must be a valid URL', 'logo_url');
  }

  if (!dbInput.accent_color || !isValidHexColor(dbInput.accent_color)) {
    throw new ValidationError('accent_color must be a valid hex color', 'accent_color');
  }

  if (!dbInput.base_color || !isValidHexColor(dbInput.base_color)) {
    throw new ValidationError('base_color must be a valid hex color', 'base_color');
  }

  // ============================================================================
  // COMPUTATION: Calculate derived fields
  // ============================================================================
  
  // Calculate total posts needed
  // WHY: This determines how many posts the calendar must generate
  const weeksTotal = Math.ceil(dbInput.total_days / 7);
  const totalPostsRequired = weeksTotal * dbInput.frequency_per_week;

  // Calculate date range
  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(startDate.getDate() + dbInput.total_days);

  console.log(`[InputNormalizer] ✓ Validation passed. Posts needed: ${totalPostsRequired}`);

  // ============================================================================
  // NORMALIZATION: Transform to standard format
  // ============================================================================
  
  return {
    campaignId: dbInput.campaign_id,
    industry: dbInput.industry.trim(),
    totalDays: dbInput.total_days,
    frequencyPerWeek: dbInput.frequency_per_week,
    festivalEnabled: dbInput.festival_enabled ?? false,
    branding: {
      logoUrl: dbInput.logo_url,
      fontStyle: dbInput.font_style || 'Arial',
      accentColor: normalizeHexColor(dbInput.accent_color),
      baseColor: normalizeHexColor(dbInput.base_color),
    },
    services: dbInput.services.map((s) => s.trim()).filter((s) => s.length > 0),
    geography: dbInput.geography || 'India',
    totalPostsRequired,
    startDate,
    endDate,
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Validates URL format
 * WHY: Prevents broken logo URLs
 */
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates hex color format
 * WHY: Ensures colors can be used in image generation prompts
 */
function isValidHexColor(color: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(color);
}

/**
 * Normalizes hex color to uppercase with #
 * WHY: Consistent format for downstream modules
 */
function normalizeHexColor(color: string): string {
  return color.toUpperCase();
}
