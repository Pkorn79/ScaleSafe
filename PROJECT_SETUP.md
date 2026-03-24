# ScaleSafe — Project Setup Guide

## Prerequisites

Install these before starting:

1. **Node.js 18+** — https://nodejs.org (download LTS version)
2. **Git** — https://git-scm.com (if not already installed)
3. **Claude Code CLI** — `npm install -g @anthropic-ai/claude-code`
4. **Cursor IDE** — https://cursor.com (download and install)

## Step 1: Clone Your Repo

```bash
git clone https://github.com/Pkorn79/ScaleSafe.git
cd ScaleSafe
```

## Step 2: Copy This Context Package

Place `SCALESAFE_CONTEXT_PACKAGE.md` in the repo root (it should already be there if you downloaded it from Cowork).

## Step 3: Initialize the GHL App Template

Claude Code will handle this during planning, but the base comes from:
https://github.com/GoHighLevel/ghl-marketplace-app-template

The template provides: Express.js + TypeScript backend, Vue 3 frontend, OAuth flow, webhook handling, SSO.

## Step 4: Create Your .env File

```bash
cp .env.example .env
```

Fill in (you'll get these from GHL Developer Portal + your existing accounts):
```
# GHL Marketplace App
GHL_APP_CLIENT_ID=
GHL_APP_CLIENT_SECRET=
GHL_API_DOMAIN=https://services.leadconnectorhq.com
GHL_APP_SSO_KEY=

# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_KEY=

# accept.blue (test merchant — PMG)
AB_API_KEY=
AB_TOKENIZATION_KEY=

# Claude API (for AI Defense Compiler)
ANTHROPIC_API_KEY=

# Server
PORT=3000
NODE_ENV=development
```

## Step 5: Start Claude Code in Plan Mode

```bash
cd ScaleSafe
claude --plan
```

Then tell Claude Code:
```
Read SCALESAFE_CONTEXT_PACKAGE.md — this is the complete briefing for the ScaleSafe project.
We are building a GHL Marketplace app in Node.js that replaces our Make.com prototype.
Start by designing the architecture. Do not write code yet.
```

## Step 6: Open Cursor

Open the ScaleSafe folder in Cursor for visual code review alongside Claude Code.

## Recommended Workflow

1. **Claude Code** (terminal) — heavy building, scaffolding, multi-file changes
2. **Cursor** (IDE) — visual review, targeted edits, asking "what does this do?"
3. **Cowork** (Claude Desktop) — planning, research, Make.com management during transition

## GHL Developer Portal Setup

Before building, you need to register your app:
1. Go to https://marketplace.gohighlevel.com
2. Create a developer account (or use existing GHL account)
3. Create a new app → get CLIENT_ID, CLIENT_SECRET, SSO_KEY
4. Set OAuth redirect URL to `http://localhost:3000/authorize-handler` (for development)
5. Configure webhook URL (for GHL events) once your app is deployed

## Key npm Packages You'll Need

```json
{
  "@gohighlevel/api-client": "latest",
  "@anthropic-ai/sdk": "latest",
  "@supabase/supabase-js": "latest",
  "express": "^4.18",
  "dotenv": "^16",
  "crypto-js": "^4",
  "pdfkit": "latest",
  "bullmq": "latest",
  "ioredis": "latest"
}
```

These will be refined during architecture planning.
