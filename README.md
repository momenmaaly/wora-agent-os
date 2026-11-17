# Wora Agent OS (v4.1 — 2026 Production Edition)

Your AI workforce — autonomous & collaborative agents operating inside an isolated 3D KameHouse-style virtual office.

## Architecture

```text
wora-agent-os/
├── api-server/                  # Node.js 22 + Express 5 + Socket.IO + BullMQ + Mongoose
│   ├── src/
│   │   ├── index.ts             # Server bootstrap
│   │   ├── wora-server.ts       # Hardened HTTP/WS server, Zod validation, CORS, Redis rate limiter
│   │   ├── ai/BrainAdapter.ts   # Streaming adapters: @google/genai (Gemini 2.5), OpenAI, Anthropic, Groq
│   │   ├── queue/AiQueue.ts     # Zero-secret BullMQ job queue & worker
│   │   ├── core/SharedWorkspaceManager.ts # Room+Zone isolated state with O(1) batched mGet
│   │   ├── store/PresenceStore.ts         # Atomic Lua presence store in Redis
│   │   ├── models/              # Strict Mongoose schemas (Agent, WorkspaceEntry)
│   │   ├── lib/logger.ts        # Redacted Pino structured logger
│   │   └── scripts/             # seed.ts (idempotent Mongo seeder) & preview-server.ts (sandbox demo)
│   └── Dockerfile               # Multi-stage non-root production build (context: repo root)
├── client/                      # React 18 + Vite 5 + React Three Fiber + Zustand 5 + Tailwind 3
│   ├── src/
│   │   ├── hooks/useSocket.ts   # Singleton Socket Manager (zero duplicate streams)
│   │   ├── store/useWoraStore.ts
│   │   ├── components/          # AgentSidebar, ChatPanel, SharedWorkspaceHUD, StatusBar, three/World
│   │   └── index.css            # Clean Tailwind dark theme tokens
│   └── Dockerfile               # Multi-stage Vite → Nginx 1.27 Alpine with dynamic $PORT
├── shared/types/index.ts        # Shared TypeScript contracts & 2026 model registry
├── nginx/nginx.conf             # TLS 1.2/1.3 reverse proxy, WebSocket sticky balancer & security headers
└── docker-compose.prod.yml      # Production stack (API ×2, Client, Nginx, Redis noeviction)
```

## Instant Sandbox Preview (No Redis / MongoDB Required)

```bash
# Terminal 1 — in-memory preview server with all 4 seeded agents & streaming simulation
cd api-server && npm ci && npm run dev:preview

# Terminal 2 — 3D React Three Fiber client (http://localhost:5173)
cd client && npm ci && npm run dev
```

> Add `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GROQ_API_KEY` to stream live LLM completions directly in preview mode.

## Quick Start (Full Local Development)

```bash
# 1. Configure environment
cp .env.example .env

# 2. Install, seed, and start API server (requires Redis & MongoDB)
cd api-server
npm ci
npm run seed
npm run dev

# 3. Install and start client (in a second terminal)
cd client
npm ci
npm run dev
```

## Production Deploy (Docker Compose)

```bash
cp .env.example .env
# Edit .env and set MONGO_URI, REDIS_PASSWORD, ALLOWED_ORIGINS, ADMIN_API_KEY, and AI keys

docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec api node dist/seed.mjs
```

## Production Deploy (Railway)

1. Deploy `api-server` from repo root using `api-server/Dockerfile`.
2. Attach Railway Redis + MongoDB Atlas URI.
3. Configure `MONGO_URI`, `REDIS_URL`, `ALLOWED_ORIGINS`, `ADMIN_API_KEY`, `AUTH_SECRET` (optional), and provider keys (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`).
4. Run `node dist/seed.mjs` once to seed the 4 core agents (`@Aria`, `@Atlas`, `@Sentinel`, `@Nova`).
5. Deploy `client` with root directory `client` and set `VITE_API_URL` + `VITE_SOCKET_URL` to your API URL.
