# Railway Deployment Quick Checklist

## ✅ Configuration Files Created

All necessary files have been configured for Railway deployment:

1. **`/railway.json`** - Railway build configuration
2. **`/nixpacks.toml`** - Build phases and commands  
3. **`/RAILWAY_DEPLOYMENT.md`** - Complete deployment guide
4. **`/package.json`** - Added `build:backend` script
5. **`/turbo.json`** - Updated for production builds
6. **`/apps/backend/src/health.controller.ts`** - Health check endpoint
7. **`/apps/backend/src/main.ts`** - Fixed PORT binding + dynamic CORS
8. **`/apps/backend/.env.example`** - All environment variables documented

---

## 🚀 Pre-Deployment Checklist

### 1. Generate New Encryption Key
```bash
openssl rand -base64 32
```
**Save this** - you'll need it for Railway environment variables.

### 2. Prepare API Keys
Make sure you have:
- [ ] Alchemy API keys (Ethereum, Base, Arbitrum)
- [ ] Biconomy bundler/paymaster URLs
- [ ] All paymaster addresses
- [ ] Paymaster token addresses

### 3. Git Push
```bash
git add .
git commit -m "Configure Railway deployment"
git push origin wdk
```

---

## 🔧 Railway Setup Steps

### Step 1: Create Project
1. Go to https://railway.app
2. New Project → Deploy from GitHub
3. Select `Tempwallets.com` repo
4. Select `wdk` branch

### Step 2: Add PostgreSQL
1. Click "+ New" → Database → PostgreSQL
2. Railway auto-creates `DATABASE_URL` variable

### Step 3: Configure Environment Variables
Set these in Railway dashboard → Variables tab:

**Required Variables:**
```bash
DATABASE_URL=${{Postgres.DATABASE_URL}}  # Auto-set
WALLET_ENC_KEY=<paste your generated key>
NODE_ENV=production
PORT=${{PORT}}  # Auto-set
FRONTEND_URL=https://your-frontend.vercel.app

# Blockchain RPCs
ETH_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
ARB_RPC_URL=https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY
POLYGON_RPC_URL=https://polygon-rpc.com
TRON_RPC_URL=https://api.trongrid.io
BTC_RPC_URL=https://blockstream.info/api
SOL_RPC_URL=https://api.mainnet-beta.solana.com

# ERC-4337 Config (see .env.example for full list)
ETH_BUNDLER_URL=...
ETH_PAYMASTER_URL=...
# ... etc
```

Copy all values from your `.env.example` and replace with your actual keys.

### Step 4: Deploy
Railway will automatically deploy after you connect the repo.

### Step 5: Verify
```bash
curl https://your-backend.up.railway.app/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2025-10-31T...",
  "uptime": 123.45,
  "environment": "production"
}
```

---

## 📋 What Was Fixed

### Issue 1: PORT Binding ✅
**Before:**
```typescript
await app.listen(process.env.PORT ?? 5005);
```

**After:**
```typescript
const port = parseInt(process.env.PORT || '5005', 10);
await app.listen(port);
```

### Issue 2: CORS Configuration ✅
**Before:** Hardcoded localhost origins only

**After:** Dynamic origins with `FRONTEND_URL` environment variable

### Issue 3: Database Migrations ✅
**Added to `start:prod`:**
```json
"start:prod": "prisma migrate deploy && node dist/main.js"
```

### Issue 4: Health Check ✅
Created `/health` endpoint for Railway monitoring

### Issue 5: Monorepo Build ✅
Added `build:backend` script:
```json
"build:backend": "turbo run build --filter=backend..."
```

This builds:
1. `packages/types` (dependency)
2. `apps/backend` (main app)

### Issue 6: Environment Variables ✅
Updated `.env.example` with ALL required variables including:
- `WALLET_ENC_KEY` (critical!)
- `FRONTEND_URL`
- `NODE_ENV`
- Polygon configuration
- ERC-4337 shared config
- All paymaster token addresses

### Issue 7: Graceful Shutdown ✅
Added to `main.ts`:
```typescript
app.enableShutdownHooks();
```

---

## 🎯 Build Process Flow

### On Railway Deployment:

```
1. Install Dependencies
   └─ pnpm install --frozen-lockfile
      ├─ Installs all packages
      └─ Runs "postinstall": prisma generate

2. Build Phase
   └─ pnpm run build:backend
      └─ turbo run build --filter=backend...
         ├─ Builds packages/types (dependency)
         └─ Builds apps/backend (main app)

3. Start Phase  
   └─ cd apps/backend && pnpm run start:prod
      └─ prisma migrate deploy && node dist/main.js
         ├─ Applies database migrations
         └─ Starts NestJS server
```

---

## 🔍 Testing Locally

Test the production build process locally:

```bash
# 1. Build backend with dependencies
pnpm run build:backend

# 2. Navigate to backend
cd apps/backend

# 3. Run migrations
pnpm run migrate:deploy

# 4. Start production server
NODE_ENV=production pnpm run start:prod
```

---

## 📊 Monitoring

### Check Logs
Railway Dashboard → Deployments → Latest → View Logs

### Health Check
```bash
curl https://your-backend.up.railway.app/health
```

### Database
Use Railway's built-in database viewer or connect with:
```bash
# Get DATABASE_URL from Railway
psql $DATABASE_URL
```

---

## ⚠️ Common Issues & Solutions

### Build fails with "Cannot find module @repo/types"
**Solution:** Ensure `turbo.json` has correct `dependsOn: ["^build"]`

### "relation does not exist" error
**Solution:** Check logs for migration errors. Migrations should run automatically.

### CORS errors from frontend
**Solution:** Set `FRONTEND_URL` in Railway environment variables

### App crashes on startup
**Solution:** Check `WALLET_ENC_KEY` is set correctly

---

## 🎉 You're Ready!

All configuration is complete. Follow the steps above to deploy to Railway.

For detailed instructions, see `/RAILWAY_DEPLOYMENT.md`

---

**Last Updated:** October 31, 2025
