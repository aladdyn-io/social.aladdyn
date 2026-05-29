# Testing Checklist for Architecture Fixes

## ✅ Compilation & Build

- [x] TypeScript compiles without errors (`npx tsc --noEmit`)
- [x] All migrations applied successfully
- [x] Database tables created with correct schema

## 🧪 Functionality Tests

### 1. Strategy Persistence

**Test**: Generate a campaign and verify strategy is saved to DB

```bash
# Run pipeline for a test campaign
POST /api/campaigns/:campaignId/generate

# Verify strategy saved
SELECT * FROM strategies WHERE campaign_id = 'test-campaign-id';

# Expected: One row with strategy_id, content_pillars, campaign_phases
```

**Checklist**:

- [ ] Strategy saved with all fields populated
- [ ] campaign_phases JSONB contains array of phases
- [ ] content_mix values sum to 100
- [ ] strategy_id is UUID

---

### 2. Calendar Persistence

**Test**: Verify calendar entries are saved after generation

```bash
# After pipeline runs
SELECT * FROM calendar_entries
WHERE campaign_id = 'test-campaign-id'
ORDER BY scheduled_date;

# Expected: N rows (where N = posting_days)
```

**Checklist**:

- [ ] All calendar entries saved
- [ ] day_number sequence is correct (1, 2, 3...)
- [ ] Topics are AI-generated (not templates)
- [ ] strategy_id links to strategies table
- [ ] Unique constraint on (campaign_id, scheduled_date) works

---

### 3. AI Topic Generation

**Test**: Verify topics are contextual and unique

```bash
# Check generated topics
SELECT day_number, pillar, topic
FROM calendar_entries
WHERE campaign_id = 'test-campaign-id';
```

**Expected Results**:

- Topics are specific (not generic templates)
- No duplicate topics
- Topics relate to pillar
- Festival topics mention the festival

**Example Good Topics**:

```
Day 1: "5 essential tips for choosing the right health insurance plan"
Day 2: "Customer story: How Sarah saved $500 on her family coverage"
Day 3: "Limited offer: Free health check-up with new policies this month"
```

**Checklist**:

- [ ] Topics are specific and actionable
- [ ] Topics vary between posts
- [ ] Festival topics integrate the festival name
- [ ] Topics align with content_type (education/trust/promotion)

---

### 4. Campaign Phases

**Test**: Verify phases are generated for campaigns ≥14 days

```bash
# Test with 30-day campaign, awareness goal
POST /api/campaigns/:campaignId/generate
{
  "total_days": 30,
  "campaign_goal": "awareness",
  ...
}

# Check strategy
SELECT campaign_phases FROM strategies WHERE campaign_id = 'test-id';
```

**Expected**:

```json
[
  {
    "dayRange": [1, 10],
    "focus": "Awareness phase",
    "contentMixOverride": { "education": 60, "trust": 30, "promotion": 10 },
    "guidance": "Focus on educating audience..."
  },
  {
    "dayRange": [11, 20],
    "focus": "Consideration phase",
    ...
  },
  {
    "dayRange": [21, 30],
    "focus": "Conversion phase",
    ...
  }
]
```

**Checklist**:

- [ ] Campaigns <14 days: no phases
- [ ] Campaigns ≥14 days: 2-3 phases generated
- [ ] Phase dayRanges cover full campaign duration
- [ ] contentMixOverride sums to 100
- [ ] Phase progression makes sense (awareness → consideration → conversion)

---

### 5. Campaign Goals

**Test**: Verify different goals produce different strategies

```bash
# Test awareness goal
POST /api/campaigns/:campaignId/generate
{ "campaign_goal": "awareness", ... }

# Test conversion goal
POST /api/campaigns/:campaignId2/generate
{ "campaign_goal": "conversion", ... }

# Compare strategies
SELECT campaign_id, campaign_phases FROM strategies;
```

**Expected Differences**:

- Awareness: More education-focused phases
- Conversion: More promotion in later phases
- Consideration: Trust-building emphasis
- Retention: Relationship-focused content

**Checklist**:

- [ ] Awareness campaigns emphasize education
- [ ] Conversion campaigns include promotional phases
- [ ] Consideration campaigns build trust
- [ ] Retention campaigns focus on engagement

---

### 6. Pipeline Integration

**Test**: Full pipeline execution with persistence

```bash
# Run complete pipeline
POST /api/campaigns/:campaignId/generate
{
  "industry": "FinTech",
  "total_days": 30,
  "frequency_per_week": 7,
  "festival_enabled": true,
  "services": ["Life Insurance", "Health Insurance"],
  "geography": "India",
  "campaign_goal": "conversion",
  ...
}
```

**Expected Flow**:

1. Input normalized ✓
2. Strategy generated (LLM) ✓
3. **Strategy saved to DB** ← NEW
4. Festivals fetched ✓
5. Calendar generated with AI topics (LLM) ✓
6. **Calendar saved to DB** ← NEW
7. Posts generated (LLM + prompts) ✓
8. Posts saved to DB ✓

**Checklist**:

- [ ] No errors in console
- [ ] Strategy persisted with strategy_id
- [ ] Calendar persisted with correct strategy_id
- [ ] Posts generated with image prompts
- [ ] Response includes strategy, calendar, posts

---

### 7. Database Integrity

**Test**: Verify foreign key relationships

```bash
# Verify cascade deletes work
DELETE FROM campaigns WHERE campaign_id = 'test-id';

# Check related records deleted
SELECT COUNT(*) FROM strategies WHERE campaign_id = 'test-id';  -- Should be 0
SELECT COUNT(*) FROM calendar_entries WHERE campaign_id = 'test-id';  -- Should be 0
SELECT COUNT(*) FROM posts WHERE campaign_id = 'test-id';  -- Should be 0
```

**Checklist**:

- [ ] Deleting campaign cascades to strategies
- [ ] Deleting campaign cascades to calendar_entries
- [ ] Deleting campaign cascades to posts
- [ ] Deleting strategy cascades to calendar_entries
- [ ] Posts link to calendar_entry_id and strategy_id

---

### 8. Error Handling

**Test**: Graceful degradation when AI fails

```bash
# Simulate AI failure (invalid API key)
OPENAI_API_KEY=invalid npx tsx src/server.ts

# Run pipeline
POST /api/campaigns/:campaignId/generate
```

**Expected Behavior**:

- Topic generation should fall back to templates
- Pipeline should continue (not crash)
- Error logged but not blocking

**Checklist**:

- [ ] AI failure doesn't crash pipeline
- [ ] Fallback topics generated
- [ ] Error logged appropriately
- [ ] Response still returns

---

## 🔍 Manual Verification

### Topic Quality Check

Manually review 10 generated topics:

```sql
SELECT topic FROM calendar_entries
WHERE campaign_id = 'test-id'
LIMIT 10;
```

**Criteria**:

- [ ] Specific (not generic)
- [ ] Actionable
- [ ] Unique (no duplicates)
- [ ] Appropriate for pillar
- [ ] Professional tone
- [ ] 10-100 words

---

### Phase Logic Check

For 30-day awareness campaign:

```sql
SELECT campaign_phases FROM strategies
WHERE campaign_id = 'test-id';
```

**Verify**:

- [ ] 3 phases present
- [ ] Phase 1: Days 1-10, education-heavy
- [ ] Phase 2: Days 11-20, balanced
- [ ] Phase 3: Days 21-30, consideration/conversion
- [ ] All guidance text is relevant

---

### Calendar Consistency Check

Verify calendar matches strategy:

```sql
SELECT
  ce.day_number,
  ce.pillar,
  ce.topic,
  s.content_pillars
FROM calendar_entries ce
JOIN strategies s ON ce.strategy_id = s.strategy_id
WHERE ce.campaign_id = 'test-id';
```

**Verify**:

- [ ] Pillars match strategy.content_pillars
- [ ] Topics align with pillars
- [ ] Festival posts are appropriately placed
- [ ] Day numbers are sequential

---

## 📊 Performance Benchmarks

### Baseline Metrics (to measure)

**Calendar Generation** (30-day campaign):

- Target: <5 seconds (includes 30 AI topic generations)
- Acceptable: <10 seconds
- Critical: >15 seconds (investigate)

**Strategy Persistence**:

- Target: <100ms
- Acceptable: <500ms

**Calendar Persistence** (30 entries):

- Target: <500ms
- Acceptable: <1 second

**Full Pipeline** (30-day campaign):

- Target: <60 seconds (includes image prompt generation)
- Acceptable: <120 seconds

---

## 🐛 Known Issues to Watch For

1. **Topic generation timeout**: If OpenAI is slow, topic generation might timeout
   - **Solution**: Increase timeout, reduce batch size

2. **Duplicate topics**: AI might generate similar topics despite instructions
   - **Solution**: Improve duplicate detection in prompt

3. **Phase boundaries**: Sharp transitions between phases might feel abrupt
   - **Future**: Add gradient transitions

4. **Strategy versioning**: Editing campaigns doesn't version strategies
   - **Future**: Add strategy versioning

5. **Calendar editing**: No UI to edit calendar entries yet
   - **Future**: Add calendar CRUD endpoints

---

## 🧪 Pipeline V2 & Ad Compositor Integration Tests

### 9. Staged Pipeline Resumability & Overrides
- [ ] Initialize campaign and verify `PipelineRun` status starts at `PENDING`.
- [ ] Run strategy stage and verify `PipelineStageOutput` status is `COMPLETED` and has `outputJson`.
- [ ] Test human override endpoint `POST /api/v1/campaigns/:campaignId/stages/generateStrategy/override` and verify downstream stages (`generateCalendar`, `generatePosts`) are reset back to `PENDING` status.
- [ ] Resume pipeline run and verify it picks up exactly at the `generateCalendar` stage and uses the overridden strategy JSON.

### 10. Playwright 3D Sandwich Compositing Overlay
- [ ] Verify image generation compiles cleanly and triggers `renderAdComposite`.
- [ ] Confirm Playwright browser spawns, loads custom fonts, and saves the final PNG.
- [ ] Verify 3D sandwich structure: watermark outlines rendered behind ONNX transparency foreground product cutout, with legible text in front of it.
- [ ] Verify OCR scan gibberish filter correctly triggers background re-rolls if lettering is noisy/unreadable.

### 11. Color Sampling Relative Luminance Legibility Solver
- [ ] Sample local contrast colors under different background lighting:
  - If dark, verify text renders white/light (`#FFFFFF`).
  - If bright, verify text renders dark/brand color.
  - If high-complexity clutter, verify a frosted-glass card backplate with relative alpha opacity is automatically rendered.
- [ ] Verify luxury typography cursive script highlights load properly (`Caveat`/`Pacifico`) and render with the slanted styling.
- [ ] Verify features list checklist matches chosen `badgeStyle` (`solid` circles or `double_ring` outlines).
- [ ] Verify pill-shaped CTA buttons display white leading arrow containers.

### 12. LinkedIn Direct Publishing & OAuth Flow
- [ ] Launch `src/test_linkedin_real.ts` local listener.
- [ ] Link a test profile, verify redirect callback exchanges token, encrypts it (AES-256-GCM), and upserts connection record.
- [ ] Verify `demo.html` connected social accounts panel refreshes and displays linked profile.
- [ ] Trigger a scheduled post, watch the publish worker capture the delayed job, stream binary chunks to LinkedIn assets, and publish UGC share successfully.

---

## ✅ Acceptance Criteria

**Minimum Requirements**:

- [x] TypeScript compiles without errors
- [x] All migrations applied
- [ ] Strategy persisted after generation
- [ ] Calendar persisted after generation
- [ ] AI topics generated (not templates)
- [ ] Campaign phases present for ≥14 day campaigns
- [ ] Campaign goals affect strategy generation
- [ ] Foreign keys work correctly
- [ ] Pipeline completes without errors

**Quality Requirements**:

- [ ] Topics are specific and unique
- [ ] Phases progress logically
- [ ] No duplicate calendar entries
- [ ] Performance is acceptable (<5s for calendar)

**Documentation**:

- [x] Architecture fixes document created
- [x] Testing checklist created
- [ ] README updated with new features
- [ ] API documentation updated

---

## 🚀 Next Steps After Testing

1. **If all tests pass**:
   - Deploy to staging
   - Test with real campaigns
   - Update frontend to display phases
   - Add calendar editing UI

2. **If tests fail**:
   - Document failures
   - Fix issues
   - Re-test
   - Update documentation

3. **Future enhancements**:
   - Add post regeneration using persisted calendar
   - Parallelize AI calls for better performance
   - Add duplicate topic detection
   - Implement strategy versioning
   - Add phase-based analytics

---

**Testing Status**: Ready for manual testing  
**Blocker Issues**: None  
**Risk Level**: Low (graceful fallbacks in place)
