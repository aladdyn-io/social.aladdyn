# 📦 Credentials Summary

## ✅ What You Can Use From Parent Project

| Service           | Status   | Usage                         |
| ----------------- | -------- | ----------------------------- |
| **PostgreSQL**    | ✅ Ready | Database for campaign inputs  |
| **OpenAI API**    | ✅ Ready | LLM for strategy + captions   |
| **MinIO Storage** | ✅ Ready | Image uploads (S3-compatible) |

## 🔧 Configuration Applied

### `.env` File

```bash
# Database (from parent)
DATABASE_URL=postgresql://postgres:***@turntable.proxy.rlwy.net:46695/railway

# OpenAI (from parent)
OPENAI_API_KEY=sk-proj-***
LLM_MODEL=gpt-4-turbo-preview

# MinIO Storage (from parent)
STORAGE_TYPE=minio
MINIO_ENDPOINT=console-production-0100.up.railway.app
MINIO_PORT=80
MINIO_USE_SSL=true
MINIO_ACCESS_KEY=y3P1EZ77LDDQGdsXSika1
MINIO_SECRET_KEY=k2RgnWHTCTXZ8wdsK6JuOmZR8N24l9zjMSSl7nqH
MINIO_BUCKET_NAME=aladdyn
MINIO_PUBLIC_ENDPOINT=https://bucket-production-e458.up.railway.app

# Still needed: Image generation provider
IMAGE_PROVIDER=local  # or 'replicate' or 'huggingface'
```

### Code Updates Made

1. **`s3Uploader.ts`**
   - Added MinIO support alongside AWS S3
   - Auto-detects storage type from `STORAGE_TYPE` env var
   - Creates bucket if it doesn't exist
   - Uses public endpoint from parent project

2. **`database.ts`**
   - Now uses `DATABASE_URL` connection string
   - Works with Railway PostgreSQL from parent project

3. **`package.json`**
   - Added `minio` package for MinIO support
   - Added `@types/uuid` for TypeScript types

## 🎯 What's Left

**Only 1 thing:** Configure image generation

Choose one:

- **Local Stable Diffusion** (free, unlimited, requires setup)
- **Replicate API** (~$0.01/image, instant)
- **HuggingFace API** (free tier, rate limited)

See [SETUP.md](SETUP.md) for detailed instructions.

## 🚀 Ready to Run

```bash
# After configuring image generation
npm run dev
```

The pipeline will:

1. ✅ Connect to your Railway PostgreSQL
2. ✅ Use OpenAI for strategy + captions
3. ✅ Upload images to MinIO storage
4. ⏳ Generate images (needs provider config)
