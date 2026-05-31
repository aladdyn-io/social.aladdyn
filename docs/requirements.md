# 📋 Functional & Technical Requirements: Pipeline Modernization

This document outlines the detailed requirements for upgrading the manager's content generation pipeline (`social.aladdyn`) by integrating the advanced features and methodologies from the upgraded `Aladdyn Social Worker` pipeline.

---

## 1. Executive Summary & Objectives

The primary goal of this modernization is to elevate the `social.aladdyn` pipeline from a basic, linear content generator into an **interactive, premium, and self-correcting marketing engine**. 

By bringing in the proven design patterns of the `Aladdyn Social Worker` pipeline, we aim to:
1. **Elevate Visual Quality**: Transition from raw, unformatted AI images to premium, DTC-grade, editorial ad layouts using deterministic layout reasoning and HTML/CSS headless rendering.
2. **Ensure Text Legibility**: Guarantee 100% WCAG-compliant text readability in any visual environment using localized color analysis and adaptive contrast solutions.
3. **Enable User Collaboration (Resumability & Overrides)**: Break the "black-box" execution by introducing a staged, resumable state machine where users can review, pause, and override intermediate assets (like strategy and calendar topic structure) before final posts are rendered.
4. **Remove Generic Copy Defaults**: Replace hardcoded, generic script-generated CTAs and hashtags with dynamic, highly-targeted copywriting generated directly by AI agents aligned with specific target audience pain points.

---

## 2. Requirement Specifications

### 2.1 Resumable State Machine & Interactive Overrides (Core Pipeline)
The content pipeline must be transformed from a single synchronous execution path into a state-tracked, resilient multi-stage process.

* **FR-1.1: Staged Pipeline Stages**  
  The pipeline execution must be divided into discrete, sequential stages:
  1. `genieContext`: Scraped website intelligence ingestion.
  2. `normalizeInput`: Data contract validation and parsing.
  3. `generateStrategy`: Core content strategy generation.
  4. `generateCalendar`: Chronological day-by-day scheduling of topics, platforms, and funnel stages.
  5. `generatePosts`: Post-level copywriting (captions, hashtags, calls-to-action).
  6. `adCreative`: High-fidelity image and overlay rendering (on-demand).

* **FR-1.2: Database Persistence & Resumability**  
  * The pipeline execution status and outputs of each stage must be stored in PostgreSQL.
  * If a stage fails or the server restarts, the system must allow resuming from the last pending/failed stage without re-running successfully completed upstream stages.
  * Status options for each stage: `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `OVERRIDDEN`.

* **FR-1.3: Interactive Human-in-the-Loop Overrides**  
  * The API must allow a user to GET intermediate stage outputs (e.g., Campaign Strategy) while the pipeline is paused or completed.
  * The user must be able to submit a payload overriding a specific stage's output.
  * **Invalidation Logic**: Applying an override to stage $N$ must automatically invalidate all downstream stages $N+1 \dots M$ (setting their status to `PENDING` and clearing their stored JSON outputs) to prevent data mismatch, while keeping upstream stages intact.
  * The pipeline can then be resumed using the user's overridden data.

* **FR-1.4: Slot-Level Fault Isolation**  
  * During parallel post ideation and image generation, a failure in a single slot must not crash the entire campaign run. The pipeline must isolate the failure, record the slot's error, and allow other slots to successfully complete.

---

### 2.2 Deterministic DTC-Grade Ad Compositing & Rendering
Instead of outputting raw Stable Diffusion / FLUX images directly to the user, the on-demand image generation system must serve as a premium layout compositor.

* **FR-2.1: Multi-Layered Z-Index Rendering**  
  The composite engine must support layering assets using HTML/CSS to build a visual sandwich:
  1. **Layer 0 (Background)**: The AI-generated base image (clean, textless, focused on the scene).
  2. **Layer 1 (Overlay Graphic)**: Frosted-glass container or geometric solid blocks to anchor text.
  3. **Layer 2 (Brand Branding)**: High-resolution brand logo and typography.
  4. **Layer 3 (Foreground Typography)**: Premium headline, subtitle, and CTA.

* **FR-2.2: Deterministic Spatial Grid Occupancy (Saliency Analysis)**  
  * The system must automatically analyze the generated base image using a transparency mask (extracted via `rembg`) or a computer-vision heuristic.
  * It must split the canvas into a 3x3 grid (9 sectors) and calculate the percentage occupancy of the main subject/product.
  * It must dynamically select the quadrant (e.g., `top-left`, `top-right`, `bottom-left`, `bottom-right`) with the *lowest* subject occupancy to place text overlays, avoiding overlap with the main product.

* **FR-2.3: Playwright Headless Browser Rendering**  
  * The final ad composite must be composed by writing the variables into a responsive HTML template and taking a pixel-perfect screenshot using Playwright.
  * Rendering resolutions must adapt dynamically based on the target platform (e.g., Instagram Feed = 1080x1080, LinkedIn/Web Banner = 1200x628).

---

### 2.3 Local Color Analysis & Legibility Solver (Contrast Safety)
The system must guarantee readability for all overlaid copywriting regardless of whether the generated background is extremely bright, dark, or busy.

* **FR-3.1: Localized Background Sampling**  
  * The compositor must sample pixels *specifically* in the bounding area where text will be placed, rather than analyzing the overall image.
  * It must compute the relative luminance ($Y$) of the sampled local background using the standard formula:
    $$Y = 0.2126R + 0.7152G + 0.0722B$$

* **FR-3.2: Automated Contrast Solver**  
  * If the local background is dark ($Y < 0.5$), the headline and subtitle colors must automatically resolve to a high-contrast white/light color.
  * If the local background is bright ($Y \ge 0.5$), the text must resolve to black or a deep brand color.
  * **Adaptive Overlay Opacity**: If the local background has high visual complexity (standard deviation of pixel values is high), the compositor must automatically introduce a frosted-glass or solid colored background block behind the text and scale its background opacity (alpha channel) up to ensure text legibility.

---

### 2.4 AI-Driven Structured Copywriting
All post assets must have high-converting copywriting. Hardcoded scripts for hashtags and CTAs are prohibited.

* **FR-4.1: Dynamic AI Copywriting Agents**  
  * The post generation prompt must generate the caption, call-to-action (CTA), and hashtags as native, LLM-generated fields in the structured JSON output.
  * CTAs must be dynamically aligned with the campaign goal (e.g., "Awareness" goals get soft informational CTAs, "Conversion" goals get high-urgency CTAs).
  * Hashtags must be relevant to the specific topic and localized to the target geography (e.g., using popular local tags for Indian geography).

---

## 3. System Constraints & Dependencies

### 3.1 Software Dependencies
* **Playwright (Headless Chromium)**: Must be installed on the Node.js server environment to take screenshots of the ad layouts.
* **Sharp (Image Processing)**: Used for rapid local pixel sampling, cropping, and contrast calculations in Node.js.
* **Rembg / ComfyUI Server**: Access to the local ComfyUI instance or a cloud API (Replicate/Huggingface) is required to retrieve the base images and optional transparency masks.

### 3.2 Database Requirements
* **JSONB Columns**: Storing stage outputs requires a Postgres database supporting JSONB (PostgreSQL 12+ is highly recommended).
* **Cascade Deletes**: If a `PipelineRun` is deleted, its downstream stage outputs must cascade-delete automatically.
