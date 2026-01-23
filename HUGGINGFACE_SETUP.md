# 🤗 HuggingFace Setup Guide

## Step 1: Get Your HuggingFace API Token

### Option A: If you already have a HuggingFace account

1. Go to https://huggingface.co/settings/tokens
2. Click **"New token"**
3. Give it a name (e.g., "social-scene-backend")
4. Select role: **"Read"** (sufficient for inference)
5. Click **"Generate"**
6. Copy the token (starts with `hf_...`)

### Option B: If you don't have an account

1. Go to https://huggingface.co/join
2. Sign up (free)
3. Verify your email
4. Follow Option A steps above

## Step 2: Configure Your Project

1. Open your `.env` file
2. Replace `your-hf-token-here` with your actual token:

   ```bash
   HUGGINGFACE_API_TOKEN=hf_YourActualTokenHere
   ```

3. Verify the IMAGE_PROVIDER is set:
   ```bash
   IMAGE_PROVIDER=huggingface
   ```

## Step 3: Test It

```bash
npm run dev
```

## ⚠️ Important Notes

### Model Loading Time

- **First request may take 20-30 seconds** while the model loads
- You'll get a 503 error with message: "Model is loading"
- Subsequent requests will be faster (~10-15 seconds per image)
- The model stays warm for ~10-15 minutes of inactivity

### Rate Limits (Free Tier)

- **~1,000 requests/day** on free tier
- Rate limit: **~50 requests/hour**
- If you hit limits, wait a few minutes or upgrade to Pro ($9/month)

### Image Quality

- Model: **Stable Diffusion XL Base 1.0**
- Resolution: **1024x1024** (fixed on HF Inference API)
- Quality: High (same as local SDXL)
- Generation time: **10-20 seconds** per image

### Error Handling

The implementation handles these errors automatically:

| Error | Retry? | Meaning                     |
| ----- | ------ | --------------------------- |
| 503   | ✅ Yes | Model loading (wait 20-30s) |
| 429   | ✅ Yes | Rate limit hit (wait a bit) |
| 401   | ❌ No  | Invalid token (check .env)  |

## 💡 Tips

1. **Pipeline continues on errors**: If one image fails, others still generate
2. **Use descriptive prompts**: Better prompts = better images
3. **Avoid peak hours**: Faster during off-peak times
4. **Monitor usage**: Check https://huggingface.co/settings/billing

## 🚀 Ready to Run

Once you've added your token to `.env`:

```bash
npm run dev
```

You should see:

```
[ImageGenerator] Generating image using huggingface provider...
[ImageGenerator] Calling HuggingFace API...
[ImageGenerator] ✓ Image generated (xxxxx bytes)
```

## 🔗 Useful Links

- HuggingFace Docs: https://huggingface.co/docs/api-inference
- Token Settings: https://huggingface.co/settings/tokens
- Model Page: https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0
- Pricing: https://huggingface.co/pricing

## Need Help?

If you get errors:

1. Check token is correct in `.env`
2. Verify `IMAGE_PROVIDER=huggingface`
3. Try waiting 30 seconds if you see "Model is loading"
4. Check rate limits if getting 429 errors
