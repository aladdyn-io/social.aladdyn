/**
 * Inline SVG decorative doodle library.
 * Each function returns a self-contained SVG string that can be embedded
 * directly in the Playwright HTML template.
 */

export const DOODLES = {
  scribbleUnderline: (color: string, width = 120) => `
    <svg width="${width}" height="12" viewBox="0 0 120 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 8C20 2 40 10 60 6C80 2 100 9 118 4" stroke="${color}" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.6"/>
    </svg>
  `,
  
  starBurst: (color: string, size = 24) => `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" fill="${color}" opacity="0.5"/>
    </svg>
  `,
  
  arrowPointer: (color: string, size = 32) => `
    <svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 26C10 18 14 14 26 6" stroke="${color}" stroke-width="2" stroke-linecap="round" fill="none" opacity="0.5"/>
      <path d="M20 4L26 6L24 12" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.5"/>
    </svg>
  `,
  
  circleHighlight: (color: string, size = 48) => `
    <svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="24" cy="24" rx="20" ry="16" stroke="${color}" stroke-width="2" stroke-dasharray="4 3" fill="none" opacity="0.35" transform="rotate(-5 24 24)"/>
    </svg>
  `,
  
  confettiDots: (color: string, width = 60, height = 40) => `
    <svg width="${width}" height="${height}" viewBox="0 0 60 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="3" fill="${color}" opacity="0.4"/>
      <circle cx="28" cy="4" r="2" fill="${color}" opacity="0.3"/>
      <circle cx="48" cy="12" r="3.5" fill="${color}" opacity="0.35"/>
      <circle cx="18" cy="28" r="2.5" fill="${color}" opacity="0.25"/>
      <circle cx="42" cy="32" r="2" fill="${color}" opacity="0.4"/>
      <circle cx="55" cy="24" r="1.5" fill="${color}" opacity="0.3"/>
    </svg>
  `,
  
  waveLine: (color: string, width = 100) => `
    <svg width="${width}" height="16" viewBox="0 0 100 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 8C12.5 0 25 16 37.5 8C50 0 62.5 16 75 8C87.5 0 100 16 100 8" stroke="${color}" stroke-width="1.5" fill="none" opacity="0.3"/>
    </svg>
  `,
  
  sparkle: (color: string, size = 16) => `
    <svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 0L9.5 6.5L16 8L9.5 9.5L8 16L6.5 9.5L0 8L6.5 6.5L8 0Z" fill="${color}" opacity="0.4"/>
    </svg>
  `,
  
  heartOutline: (color: string, size = 20) => `
    <svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 18S2 12 2 7C2 4 4.5 2 7 2C8.5 2 9.5 3 10 4C10.5 3 11.5 2 13 2C15.5 2 18 4 18 7C18 12 10 18 10 18Z" stroke="${color}" stroke-width="1.5" fill="none" opacity="0.35"/>
    </svg>
  `
};
