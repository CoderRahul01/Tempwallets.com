# Railway Deployment Guide - Tempwallets Backend

## 🚀 Overview

This guide will help you deploy the Tempwallets backend (a Turbo monorepo) to Railway with PostgreSQL database.

## 📋 Prerequisites

- Railway account (https://railway.app)
- GitHub repository connected to Railway
- PostgreSQL plugin added to your Railway project

---

## 🏗️ Project Structure

```
Tempwallets.com/                    # Monorepo root
├── apps/
│   └── backend/                    # NestJS backend
│       ├── src/
│       ├── prisma/
│       └── package.json
├── packages/
│   ├── types/                      # Shared TypeScript types
│   └── typescript-config/          # Shared TS config
├── railway.json                    # Railway configuration
├── nixpacks.toml                   # Build configuration
├── turbo.json                      # Turbo build orchestration
└── package.json                    # Root package.json
```

---

## 🔧 Step 1: Railway Project Setup

### 1.1 Create New Project
1. Go to https://railway.app
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Choose your `Tempwallets.com` repository
5. Select the `wdk` branch

### 1.2 Add PostgreSQL Database
1. In your Railway project, click **"+ New"**
2. Select **"Database"** → **"PostgreSQL"**
3. Railway will automatically create a `DATABASE_URL` environment variable

---

## 🌍 Step 2: Configure Environment Variables

In Railway dashboard, go to your backend service → **Variables** tab and add:

### Required Variables

```bash
# Database (automatically provided by Railway PostgreSQL plugin)
DATABASE_URL=${{Postgres.DATABASE_URL}}

# Encryption Key (CRITICAL - Generate new key!)
WALLET_ENC_KEY=<YOUR_32_BYTE_BASE64_KEY>

# Server
NODE_ENV=production
PORT=${{PORT}}

# Frontend CORS (Update with your actual frontend URL)
FRONTEND_URL=https://your-frontend.vercel.app

# Ethereum Configuration
ETH_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
ETH_BUNDLER_URL=https://bundler.biconomy.io/api/v3/1/YOUR_KEY
ETH_PAYMASTER_URL=https://paymaster.biconomy.io/api/v2/1/YOUR_KEY
ETH_PAYMASTER_ADDRESS=0x00000072a5F551D6E80b2f6ad4fB256A27841Bbc
ETH_PAYMASTER_TOKEN=0xdAC17F958D2ee523a2206206994597C13D831ec7

# Base Configuration
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
BASE_BUNDLER_URL=https://bundler.biconomy.io/api/v3/8453/YOUR_KEY
BASE_PAYMASTER_URL=https://paymaster.biconomy.io/api/v2/8453/YOUR_KEY
BASE_PAYMASTER_ADDRESS=0x0000006087310897e0BFfcb3f0Ed3704f7146852
BASE_PAYMASTER_TOKEN=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

# Arbitrum Configuration
ARB_RPC_URL=https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY
ARB_BUNDLER_URL=https://bundler.biconomy.io/api/v3/42161/YOUR_KEY
ARB_PAYMASTER_URL=https://paymaster.biconomy.io/api/v2/42161/YOUR_KEY
ARB_PAYMASTER_ADDRESS=0x00000072a5F551D6E80b2f6ad4fB256A27841Bbc
ARB_PAYMASTER_TOKEN=0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9

# Polygon Configuration
POLYGON_RPC_URL=https://polygon-rpc.com
POLYGON_BUNDLER_URL=https://api.candide.dev/public/v3/polygon
POLYGON_PAYMASTER_URL=https://api.candide.dev/public/v3/polygon
POLYGON_PAYMASTER_ADDRESS=0x8b1f6cb5d062aa2ce8d581942bbb960420d875ba
POLYGON_PAYMASTER_TOKEN=0xc2132D05D31c914a87C6611C10748AEb04B58e8F

# ERC-4337 Shared Config
ENTRY_POINT_ADDRESS=0x0000000071727De22E5E9d8BAf0edAc6f37da032
SAFE_MODULES_VERSION=0.3.0
TRANSFER_MAX_FEE=100000000000000

# Tron
TRON_RPC_URL=https://api.trongrid.io

# Bitcoin
BTC_RPC_URL=https://blockstream.info/api

# Solana
SOL_RPC_URL=https://api.mainnet-beta.solana.com
```

### How to Generate WALLET_ENC_KEY

Run this command locally:
```bash
openssl rand -base64 32
```

Copy the output and paste it as the `WALLET_ENC_KEY` value in Railway.

⚠️ **NEVER use the same key from .env.example or your local .env file!**

---

## ⚙️ Step 3: Configure Build Settings

Railway should automatically detect your configuration from `railway.json` and `nixpacks.toml`, but verify:

### 3.1 Build Configuration
In Railway → **Settings** tab:

- **Root Directory**: `/` (monorepo root)
- **Build Command**: `pnpm install --frozen-lockfile && pnpm run build:backend`
- **Start Command**: `cd apps/backend && pnpm run start:prod`

### 3.2 What Happens During Build

1. **Install Phase**:
   ```bash
   pnpm install --frozen-lockfile
   # Installs all dependencies including workspace packages
   ```

2. **Build Phase**:
   ```bash
   pnpm run build:backend
   # Runs: turbo run build --filter=backend...
   # This builds:
   #   1. packages/types (dependency)
   #   2. apps/backend (main app)
   ```

3. **Start Phase**:
   ```bash
   cd apps/backend && pnpm run start:prod
   # Runs: prisma migrate deploy && node dist/main.js
   # This:
   #   1. Applies database migrations
   #   2. Starts the NestJS server
   ```

---

## 🗄️ Step 4: Database Migration

Migrations run automatically on deployment via the `start:prod` script:

```json
"start:prod": "prisma migrate deploy && node dist/main.js"
```

### First Deployment
- Railway creates an empty PostgreSQL database
- `prisma migrate deploy` runs and creates all tables:
  - `User`
  - `Wallet`
  - `WalletAddress`
  - `WalletSeed`
  - `_prisma_migrations` (migration tracking)

### Subsequent Deployments
- Prisma checks which migrations are already applied
- Only new migrations are executed
- No data loss

### Manual Migration (if needed)
If you need to run migrations manually:
```bash
# In Railway CLI or run command
cd apps/backend && pnpm run migrate:deploy
```

---

## 🔍 Step 5: Health Check

Once deployed, verify your backend is running:

```bash
curl https://your-backend-url.up.railway.app/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2025-10-31T12:00:00.000Z",
  "uptime": 123.456,
  "environment": "production"
}
```

---

## 🌐 Step 6: Update CORS

After deployment, update `main.ts` to allow your frontend URL:

The backend now reads from `FRONTEND_URL` environment variable. Make sure you set it in Railway:

```bash
FRONTEND_URL=https://your-frontend.vercel.app
```

---

## 📊 Step 7: Monitor Deployment

### View Logs
In Railway dashboard → **Deployments** → Click on latest deployment → **View Logs**

### Common Log Messages

**✅ Successful Deployment:**
```
[Nest] INFO Successfully connected to database
[Nest] INFO Application is running on port 5005
```

**❌ Common Errors:**

1. **Missing WALLET_ENC_KEY:**
   ```
   Error: WALLET_ENC_KEY environment variable is required
   ```
   **Solution**: Add the environment variable

2. **Database Connection Failed:**
   ```
   Error: Can't reach database server
   ```
   **Solution**: Check `DATABASE_URL` is set correctly

3. **Migration Failed:**
   ```
   Error: relation "WalletSeed" does not exist
   ```
   **Solution**: Check migrations ran successfully

---

## 🔄 Step 8: Redeploy

### Automatic Deployment
Railway automatically deploys when you push to the `wdk` branch:
```bash
git add .
git commit -m "Update backend"
git push origin wdk
```

### Manual Deployment
In Railway dashboard → Click **"Deploy"** button

---

## 🛠️ Troubleshooting

### Build Fails with "Cannot find module @repo/types"

**Problem**: Workspace dependencies not building correctly

**Solution**:
```bash
# Verify turbo.json has correct dependencies
# Check that packages/types has a build script
cd packages/types
pnpm run build
```

### "relation does not exist" Error

**Problem**: Database migrations didn't run

**Solution**:
```bash
# Check logs for migration errors
# Manually run migrations:
cd apps/backend
pnpm run migrate:deploy
```

### CORS Errors in Browser

**Problem**: Frontend can't connect to backend

**Solution**:
1. Set `FRONTEND_URL` in Railway environment variables
2. Verify CORS configuration in `main.ts`
3. Check frontend is using correct backend URL

### High Memory Usage

**Problem**: Railway instance running out of memory

**Solution**:
1. Upgrade Railway plan
2. Optimize WDK usage (reduce concurrent blockchain connections)
3. Add memory limits to Docker configuration

---

## 📝 Environment Variable Checklist

Before deployment, ensure these are set in Railway:

- [ ] `DATABASE_URL` (auto-set by PostgreSQL plugin)
- [ ] `WALLET_ENC_KEY` (generate new with `openssl rand -base64 32`)
- [ ] `NODE_ENV=production`
- [ ] `FRONTEND_URL` (your frontend domain)
- [ ] `ETH_RPC_URL` (Alchemy/Infura API key)
- [ ] `BASE_RPC_URL` (Alchemy API key)
- [ ] `ARB_RPC_URL` (Alchemy API key)
- [ ] All bundler/paymaster URLs
- [ ] All paymaster addresses
- [ ] All paymaster token addresses
- [ ] `ENTRY_POINT_ADDRESS`
- [ ] Other blockchain RPC URLs (Tron, Bitcoin, Solana)

---

## 🎯 Post-Deployment Checklist

After successful deployment:

- [ ] Health check endpoint returns 200 OK
- [ ] Database migrations completed
- [ ] Can create/import wallet seeds
- [ ] Can fetch wallet addresses
- [ ] Can fetch wallet balances
- [ ] Frontend can connect (no CORS errors)
- [ ] Logs show no errors
- [ ] Monitor error rates in Railway dashboard

---

## 🔐 Security Best Practices

1. **Never commit** `.env` file
2. **Rotate API keys** regularly
3. **Use Railway's** secret management (variables tab)
4. **Enable Railway's** IP restrictions if needed
5. **Monitor** logs for suspicious activity
6. **Set up** alerts for errors
7. **Backup** database regularly (Railway auto-backups)

---

## 📞 Support

If you encounter issues:

1. Check Railway logs
2. Review this documentation
3. Check Railway status page
4. Contact Railway support
5. Review NestJS/Prisma documentation

---

## 🎉 Success!

Your Tempwallets backend should now be deployed and running on Railway! 

**Backend URL**: `https://your-project.up.railway.app`

**API Endpoints**:
- `GET /health` - Health check
- `POST /wallet/seed` - Create/import seed
- `GET /wallet/addresses` - Get addresses
- `GET /wallet/balances` - Get balances
- `GET /wallet/erc4337/paymaster-balances` - Get paymaster balances
