/**
 * Audience Classifier & Brand Intelligence Utility
 * 
 * Infers company audience type (B2B vs B2C/D2C) based on vertical industry and archetype.
 * Also maps technical brand hex colors and country names into beautiful descriptive natural
 * language names that AI image generation models (like Flux or Stable Diffusion) can paint.
 * Mirrors and builds upon the Aladdyn Social Worker pipeline.
 */

/**
 * Infer B2B vs B2C/D2C from industry name and brand archetype.
 * 
 * @param industry - Company industry vertical (e.g. "B2B SaaS - Fintech", "D2C Skincare")
 * @param archetype - Brand personality archetype (e.g. "sage", "hero", "creator")
 * @returns 'b2b' | 'b2c'
 */
export function inferAudienceType(industry: string = '', archetype: string = ''): 'b2b' | 'b2c' {
  const ind = industry.toLowerCase();
  const arch = archetype.toLowerCase();
  
  const b2bSignals = [
    'saas',
    'software',
    'enterprise',
    'b2b',
    'consulting',
    'finance',
    'legal',
    'hr',
    'recruitment',
    'logistics',
    'manufacturing',
    'tech',
    'agency',
    'corporate',
    'professional services'
  ];

  if (b2bSignals.some(signal => ind.includes(signal) || arch.includes(signal))) {
    return 'b2b';
  }
  
  return 'b2c';
}

/**
 * Maps a hex color code to a beautiful, natural language descriptive color name 
 * that AI image generation models can actually interpret and paint.
 * 
 * @param hex - Hex color code (e.g. "#FF6B35" or "#0F172A")
 * @returns Descriptive color string
 */
export function getFriendlyColorName(hex: string): string {
  if (!hex) return 'natural neutral colors';
  const clean = hex.replace('#', '').trim().toLowerCase();
  if (clean.length !== 6) return 'natural neutral colors';
  
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  
  // Basic Hue-based classification
  // Red
  if (r > 200 && g < 100 && b < 100) return 'bold vibrant crimson red';
  // Green
  if (r < 100 && g > 150 && b < 100) return 'lush organic emerald green';
  // Blue
  if (r < 100 && g < 150 && b > 200) return 'cool serene electric sapphire blue';
  // Yellow
  if (r > 200 && g > 200 && b < 100) return 'warm glowing golden saffron yellow';
  // Orange
  if (r > 200 && g > 100 && g < 180 && b < 100) return 'vibrant terracotta orange';
  // Purple
  if (r > 120 && g < 100 && b > 180) return 'luxurious royal amethyst purple';
  // Pink
  if (r > 220 && g < 180 && b > 180) return 'soft delicate pastel rose pink';
  // White/very light
  if (r > 240 && g > 240 && b > 240) return 'pure minimalist alabaster white';
  // Black/very dark
  if (r < 30 && g < 30 && b < 30) return 'sleek matte midnight charcoal black';
  // Dark Slate/Navy
  if (r < 40 && g < 60 && b > 80) return 'deep luxurious navy sapphire blue';
  // Dark Green
  if (r < 50 && g > 80 && b < 80) return 'deep calming forest pine green';
  // Teal
  if (r < 100 && g > 150 && b > 150) return 'vibrant coastal marine teal';
  // Brown/Warm wood
  if (r > 100 && r < 180 && g > 60 && g < 120 && b < 80) return 'warm natural rustic teakwood brown';
  
  // Fallbacks based on dominant component
  const max = Math.max(r, g, b);
  if (max === r) return 'warm terracotta red and copper tones';
  if (max === g) return 'natural soft green and sage tones';
  return 'serene deep blue and slate tones';
}

/**
 * Returns rich, culturally authentic visual staging cues for a target geography.
 * This guides the AI image generator to produce region-appropriate backgrounds.
 * 
 * @param geography - Country or region name (e.g. "India", "USA")
 * @returns Visual staging descriptive string
 */
export function getGeographyVisualCues(geography: string): string {
  const geo = geography.trim().toLowerCase();
  
  if (geo.includes('india')) {
    return 'contemporary Indian minimalist apartment styling, warm glowing brass metal accents, rich light beige marble tiling, fresh soft marigold and jasmine flower decorations, lush green tropical indoor plants, bright warm afternoon natural sunlight casting elegant window frame shadows';
  }
  if (geo.includes('state') || geo.includes('usa') || geo.includes('canada') || geo.includes('global')) {
    return 'modern upscale Western industrial loft styling, sleek matte charcoal metal finishes, cool Nordic light grey plaster, clean light oak wood textures, bright crisp white studio lighting, large glass windows with minimal urban background';
  }
  if (geo.includes('united kingdom') || geo.includes('uk') || geo.includes('london') || geo.includes('europe')) {
    return 'classic premium European heritage styling, deep matte neutral backdrops, polished heritage brass finishes, warm vintage atmospheric desk lighting, clean sophisticated minimalist flat lay setup';
  }
  if (geo.includes('singapore') || geo.includes('asia')) {
    return 'upscale biophilic architectural modernism, rich teakwood paneling, sleek glass partitions, lush green tropical monstera and palm highlights, pristine natural bright white lighting';
  }
  if (geo.includes('emirates') || geo.includes('uae') || geo.includes('dubai') || geo.includes('east')) {
    return 'luxurious contemporary desert gold tones, premium polished cream travertine stone surfaces, elegant modern arabesque minimalist arches, warm glowing sunset lighting';
  }
  
  return 'clean premium modern minimalist design studio setting, pristine flat lay backdrop, elegant soft studio lighting, clean organic vegetation highlights';
}
