# 🔑 Environment Setup Guide

## ✅ Credentials Already Available (from parent project)

The following credentials are **already configured** in your `.env` file:

### 1. **PostgreSQL Database**

- ✅ Connected to Railway PostgreSQL
- Database: `railway`
- URL: `postgresql://postgres:***@turntable.proxy.rlwy.net:46695/railway`

### 2. **OpenAI API** (for LLM)

- ✅ API key configured
- Used for:
  - Content strategy generation
  - Caption generation
- Model: `gpt-4-turbo-preview`

### 3. **MinIO Object Storage** (S3-compatible)

- ✅ Credentials configured
- Used for: Image uploads
- Bucket: `aladdyn`
- Public URL: `https://bucket-production-e458.up.railway.app`

---

## ❌ Still Needed: Image Generation Setup

You need to configure **one** of these options:

### Option 1: Local Stable Diffusion (Free, Unlimited) ⭐ Recommended for Dev

1. **Install AUTOMATIC1111:**

   ```bash
   git clone https://github.com/AUTOMATIC1111/stable-diffusion-webui.git
   cd stable-diffusion-webui
   ```

2. **Download a model:**
   - Visit: https://civitai.com or https://huggingface.co
   - Download any SD 1.5 or SDXL model
   - Place in `stable-diffusion-webui/models/Stable-diffusion/`

3. **Run with API enabled:**

   ```bash
   # Windows
   webui.bat --api --listen

   # Linux/Mac
   ./webui.sh --api --listen
   ```

4. **Update .env:**
   ```bash
   IMAGE_PROVIDER=local
   STABLE_DIFFUSION_URL=http://localhost:7860
   ```

### Option 2: Replicate API (Easiest, Pay-per-use)

1. **Get API token:**
   - Visit: https://replicate.com
   - Sign up and get your API token

2. **Update .env:**

   ```bash
   IMAGE_PROVIDER=replicate
   REPLICATE_API_TOKEN=your-replicate-token-here
   ```

3. **Pricing:**
   - ~$0.01 per image
   - No setup required

### Option 3: HuggingFace Inference API (Free tier available)

1. **Get API token:**
   - Visit: https://huggingface.co/settings/tokens
   - Create new token

2. **Update .env:**

   ```bash
   IMAGE_PROVIDER=huggingface
   HUGGINGFACE_API_TOKEN=your-hf-token-here
   ```

3. **Note:**
   - Free tier has rate limits
   - May require model warm-up

---

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Choose your image generation provider (see above)

# 3. Run the pipeline
npm run dev
```

---

## 📋 Checklist

- [x] Database connected (PostgreSQL)
- [x] OpenAI API configured
- [x] MinIO storage configured
- [ ] Image generation provider selected and configured

**Once you configure image generation, you're ready to go!**
