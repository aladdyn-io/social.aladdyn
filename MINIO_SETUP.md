# MinIO Setup Guide

## Quick Setup (Windows)

### 1. Download MinIO
```powershell
# Download MinIO server
Invoke-WebRequest -Uri "https://dl.min.io/server/minio/release/windows-amd64/minio.exe" -OutFile "minio.exe"
```

### 2. Start MinIO
```powershell
# Create data directory
mkdir C:\minio-data

# Start server
.\minio.exe server C:\minio-data --console-address ":9001"
```

### 3. Access Console
- Console: http://localhost:9001
- Default credentials: minioadmin / minioadmin

### 4. Create Bucket
1. Login to console
2. Create bucket named "aladdyn"
3. Set bucket to public (Manage > Access > Public)

### 5. Update .env
```env
STORAGE_TYPE=minio
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET_NAME=aladdyn
MINIO_PUBLIC_ENDPOINT=http://localhost:9000
```

## Alternative: Use Cloudflare R2 (Free 10GB)
1. Sign up: https://dash.cloudflare.com/
2. Create R2 bucket
3. Get credentials
4. S3-compatible!
