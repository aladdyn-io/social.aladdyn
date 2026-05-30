# Audit: `dynamicHtmlBlock` + `NegativeSpaceZone` Implementation

After a thorough line-by-line review of all 4 changed files, here are the issues I found — ranked by severity.

---

## 🔴 Critical Bugs (Will Break Output)

### 1. `max_tokens: 2000` is too low for HTML output
**File**: [layoutDirector.ts:417](file:///C:/Users/shriy/OneDrive/Desktop/Projects/Aladdyn/social%20aladdyn/src/services/layoutDirector.ts#L417)

The Layout Director now needs to output a full JSON object containing **both** design tokens AND a complete `dynamicHtmlBlock` HTML string. The example HTML block alone in the prompt (lines 352-354) is ~1500 tokens. With the JSON wrapper + design tokens, a realistic output is 2500-4000 tokens. At `max_tokens: 2000`, the LLM will frequently get **truncated mid-HTML**, producing broken JSON that fails `JSON.parse()` and triggers the fallback.

**Fix**: Increase to `max_tokens: 4096` (or even 6000 for complex layouts with many features).

---

### 2. `negativeSpaceZone` always defaults to `left_column` regardless of layout
**File**: [generateImagePrompt.ts:88-90](file:///C:/Users/shriy/OneDrive/Desktop/Projects/Aladdyn/social%20aladdyn/src/services/generateImagePrompt.ts#L88-L90)

```typescript
const effectiveZone: NegativeSpaceZone = negativeSpaceZone || (
  layout === 'editorial_left_bleed' ? 'left_column' : 'left_column'  // ← BUG: both branches are identical!
);
```

The ternary is dead code — it returns `'left_column'` for EVERY layout, completely defeating the purpose of the `NegativeSpaceZone` system. Should map different layouts to different zones:

**Fix**:
```typescript
const effectiveZone: NegativeSpaceZone = negativeSpaceZone || (
  layout === 'editorial_left_bleed' ? 'left_column' :
  layout === 'editorial_right_bleed' ? 'right_column' :
  layout.includes('top') ? 'top_band' :
  layout.includes('bottom') ? 'bottom_band' :
  'left_column' // safe default
);
```

---

### 3. Hardcoded "LEFT 50%" references still baked into the prompt text
**File**: [generateImagePrompt.ts:154-161](file:///C:/Users/shriy/OneDrive/Desktop/Projects/Aladdyn/social%20aladdyn/src/services/generateImagePrompt.ts#L154-L161)

Even though the `SPATIAL SPLIT MANDATE` sections (lines 139-146) correctly use `zoneMandate.subjectSide` and `zoneMandate.emptyZone`, the following hardcoded strings remain unchanged:

```
Line 154: "...breathing negative space on the left 50%."  
Line 155: "...accents...on the RIGHT 50% of the image"  
Line 159: "...clean, calm margin on the left 50%..."  
Line 160: "...Ensure the left 50% is extremely bright..."  
Line 161: "...Keep the left 50% clean, dark, and muted."  
```

These will **directly contradict** the zone mandate when `effectiveZone` is `right_column`, `top_band`, etc.

**Fix**: Replace all these with `${zoneMandate.emptyZone}` and `${zoneMandate.subjectSide}` references.

---

### 4. Fonts used in `dynamicHtmlBlock` are not loaded by Google Fonts
**File**: [htmlRenderer.ts:606-613](file:///C:/Users/shriy/OneDrive/Desktop/Projects/Aladdyn/social%20aladdyn/src/services/htmlRenderer.ts#L606-L613)

The font loader only loads `headlineFont`, `subtitleFont`, `Caveat`, and `Pacifico`. But the LLM's `dynamicHtmlBlock` can use **any** Google Font via inline `font-family` styles (e.g., `Lora`, `Cinzel`, `Prata`, `DM Serif Display`). These fonts won't be loaded and will silently fall back to system fonts, making the typography look generic.

**Fix**: Extract font-family names from `dynamicHtmlBlock` via regex and add them to `fontsToLoad`:
```typescript
if (bp.dynamicHtmlBlock) {
  const fontMatches = bp.dynamicHtmlBlock.matchAll(/font-family:\s*([^;]+)/gi);
  for (const match of fontMatches) {
    const families = match[1].split(',').map(f => f.trim().replace(/['"]/g, ''));
    for (const family of families) {
      if (family && !['serif', 'sans-serif', 'cursive', 'monospace', 'inherit'].includes(family.toLowerCase())) {
        fontsToLoad.add(family);
      }
    }
  }
}
```

---

## 🟡 Quality Issues (Will Degrade Output)

### 5. Layout Director prompt is too rigid — forces one single pattern
**File**: [layoutDirector.ts:300-354](file:///C:/Users/shriy/OneDrive/Desktop/Projects/Aladdyn/social%20aladdyn/src/services/layoutDirector.ts#L300-L354)

The "COMPONENT-BASED APPROACH" section (lines 300-354) mandates a single layout pattern for EVERY ad:
1. Master Container (left gradient panel)
2. Header Block (badge + headline + subtitle)
3. Numbered Step List
4. Floating Callout Card
5. CTA Button

This means **every single ad** will look like an editorial left-column with numbered steps and a callout card — defeating the purpose of having `dynamicHtmlBlock` for diverse layouts. The `CREATIVE DIRECTION` (line 190) says things like "cyberpunk holographic", "bold neon" but the component rules force a white left gradient panel every time.

**Fix**: Present the components as a **toolkit** the LLM can mix-and-match, not a rigid sequence. Add 2-3 alternative pattern examples (centered floating text, dark card overlay, full-width top banner) and let the LLM choose based on the creative direction.

---

### 6. Prompt says font sizes are "80px, 36px, 28px" but CSS classes define "42px, 18px, 15px"
**File**: [layoutDirector.ts:198-203](file:///C:/Users/shriy/OneDrive/Desktop/Projects/Aladdyn/social%20aladdyn/src/services/layoutDirector.ts#L198-L203) vs [htmlRenderer.ts:956-981](file:///C:/Users/shriy/OneDrive/Desktop/Projects/Aladdyn/social%20aladdyn/src/services/htmlRenderer.ts#L956-L981)

The Layout Director prompt tells the LLM:
```
- class='ad-headline'  → 80px, weight 800, line-height 1.05
- class='ad-subtitle'  → 36px, line-height 1.35
- class='ad-body'      → 28px
```

But the actual CSS in htmlRenderer.ts defines:
```css
.ad-headline { font-size: 42px; }
.ad-subtitle { font-size: 18px; }
.ad-body     { font-size: 15px; }
```

The LLM will design layouts expecting 80px headlines and 36px subtitles. But the rendered output will have nearly half those sizes. This causes:
- Oversized whitespace (designed for bigger text)
- Loss of typographic hierarchy (everything looks too small)
- Layout proportions look wrong

**Fix**: Either update the CSS to match the prompt sizes, or update the prompt to tell the LLM the actual sizes. Since the font sizes no longer have `!important`, the LLM's inline styles should win — so the simplest fix is to tell the LLM the truth and let it use inline font-size when it wants bigger text.

---

### 7. Doodle regex won't match self-closing `<span>` tags
**File**: [htmlRenderer.ts:550-564](file:///C:/Users/shriy/OneDrive/Desktop/Projects/Aladdyn/social%20aladdyn/src/services/htmlRenderer.ts#L550-L564)

The doodle regex looks for `<span ...></span>` (with closing tag). But the prompt examples on [layoutDirector.ts:337-338](file:///C:/Users/shriy/OneDrive/Desktop/Projects/Aladdyn/social%20aladdyn/src/services/layoutDirector.ts#L337-L338) show:
```html
<span data-doodle="starBurst" data-doodle-color="ACCENT_COLOR" style="..."></span>
```

LLMs sometimes output self-closing `<span ... />` or `<span ...>` without closing tag. The regex won't match these, and the doodle won't render.

**Fix**: Add a third regex to catch self-closing variants:
```typescript
bp.dynamicHtmlBlock = bp.dynamicHtmlBlock.replace(
  /<(div|span)\s+[^>]*data-doodle=['"]([^'"]+)['"][^>]*data-doodle-color=['"]([^'"]+)['"][^>]*\/>/gi,
  (match, tag, doodleName, color) => { ... }
);
```

---

### 8. Footer trust bar uses hardcoded placeholder badges
**File**: [htmlRenderer.ts:1110-1118](file:///C:/Users/shriy/OneDrive/Desktop/Projects/Aladdyn/social%20aladdyn/src/services/htmlRenderer.ts#L1110-L1118)

```typescript
(bp.features && bp.features.length > 0
  ? bp.features.slice(0, 3)
  : ['Quality Assured', 'Made with Care', 'Trusted Brand']  // ← Hardcoded generic text
)
```

The fallback trust badges say "Quality Assured", "Made with Care", "Trusted Brand" — these are generic placeholders that look unprofessional and don't match the industry. Should use the CopyBlueprint's actual feature text or brand-specific trust signals.

**Fix**: Use `copyElements` badge/feature text if available, or derive from the industry (e.g., "FDA Compliant" for skincare, "SOC 2 Certified" for SaaS).

---

### 9. Lucide CDN uses `@latest` — fragile in production
**File**: [htmlRenderer.ts:1048](file:///C:/Users/shriy/OneDrive/Desktop/Projects/Aladdyn/social%20aladdyn/src/services/htmlRenderer.ts#L1048)

```html
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>
```

Using `@latest` means any breaking change to the Lucide library could silently break icon rendering. Pin to a specific version.

**Fix**: `https://unpkg.com/lucide@0.460.0/dist/umd/lucide.js`

---

## 🟢 Minor Improvements

### 10. No `onDemandImageGeneration.ts` doesn't pass `negativeSpaceZone` from saliency
**File**: [onDemandImageGeneration.ts:231-237](file:///C:/Users/shriy/OneDrive/Desktop/Projects/Aladdyn/social%20aladdyn/src/services/onDemandImageGeneration.ts#L231-L237)

The on-demand pipeline calls `generateDetailedImagePrompt()` but never passes a `negativeSpaceZone` — it only passes `preferredLayout`. The saliency-solved `safestQuadrant` is computed AFTER image generation (line 301), but the image prompt is generated BEFORE (line 231). This is a chicken-and-egg problem that means negative space zones are never actually driven by saliency data.

**Fix**: This is architectural and acceptable for now — the image prompt sets the initial composition, and saliency analysis works within those bounds. But long-term, consider a two-pass approach where a quick pre-analysis of the brand's typical layouts drives the zone selection.

---

### 11. `resolvedBrand` variable is declared but never used
**File**: [layoutDirector.ts:82](file:///C:/Users/shriy/OneDrive/Desktop/Projects/Aladdyn/social%20aladdyn/src/services/layoutDirector.ts#L82)

```typescript
const resolvedBrand = params.industry || 'Aladdyn';  // Never referenced
```

Dead code — should be removed or used in the prompt.

---

### 12. `contrastShieldClass` is always an empty string
**File**: [htmlRenderer.ts:450](file:///C:/Users/shriy/OneDrive/Desktop/Projects/Aladdyn/social%20aladdyn/src/services/htmlRenderer.ts#L450)

```typescript
const contrastShieldClass = ''; // Disabled to keep typography clean and crisp
```

This is used in multiple template HTML strings (lines 997, 1003, 769) adding empty class names. Either remove the variable and all references, or re-enable it conditionally.

---

## Summary

| # | Severity | File | Issue |
|---|----------|------|-------|
| 1 | 🔴 Critical | layoutDirector.ts | `max_tokens: 2000` too low for HTML output — will truncate |
| 2 | 🔴 Critical | generateImagePrompt.ts | Both ternary branches return `'left_column'` — dead code |
| 3 | 🔴 Critical | generateImagePrompt.ts | Hardcoded "LEFT 50%" text contradicts dynamic zone mandate |
| 4 | 🔴 Critical | htmlRenderer.ts | Fonts from dynamicHtmlBlock not loaded by Google Fonts loader |
| 5 | 🟡 Quality | layoutDirector.ts | Rigid single-pattern component rules kill layout diversity |
| 6 | 🟡 Quality | layoutDirector.ts vs htmlRenderer.ts | Prompt says "80px" but CSS defines "42px" — proportion mismatch |
| 7 | 🟡 Quality | htmlRenderer.ts | Doodle regex misses self-closing span/div variants |
| 8 | 🟡 Quality | htmlRenderer.ts | Footer trust badges are hardcoded generic placeholders |
| 9 | 🟡 Quality | htmlRenderer.ts | Lucide `@latest` is fragile in production |
| 10 | 🟢 Minor | onDemandImageGeneration.ts | negativeSpaceZone never passed from saliency analysis |
| 11 | 🟢 Minor | layoutDirector.ts | `resolvedBrand` declared but never used |
| 12 | 🟢 Minor | htmlRenderer.ts | `contrastShieldClass` always empty string |

---

## Recommended Fix Priority

> [!IMPORTANT]
> **Fix these first** — they will cause visible failures:
> 1. Bump `max_tokens` to 4096+ (1 line change)
> 2. Fix the dead-code ternary in `effectiveZone` (1 line change)
> 3. Replace hardcoded "LEFT 50%" strings with zone variables (5 line changes)
> 4. Extract fonts from `dynamicHtmlBlock` and add to Google Fonts loader (~10 lines)

> [!TIP]
> **Fix next for quality uplift**:
> 5. Relax the component rules to present them as a toolkit, add 2-3 alternative layout examples
> 6. Align prompt font size descriptions with actual CSS values

Want me to implement these fixes?
