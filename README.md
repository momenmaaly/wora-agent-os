# Wora Agent OS

Wora is an Arabic-first workspace for operating an AI team. It opens directly in the working area: a ten-department model or floor plan, the live roster, and the department task board. **Enlarge workspace** hides the surrounding navigation and gives the map the available screen; **Escape** or the same control restores it. On narrow screens, the enlarged model is horizontally scrollable. The optional tour is under **Help**. The director's office is available from the map and the main navigation.

## WORA OS core (execution platform)

Beyond the workspace UI, this branch includes the **WORA OS core** — a real execution platform: a persistent agent registry (18 seeded specializations + custom agents), a mission orchestrator with review gates and mandatory handoff contracts, 16 permissioned tools (HiGHS LP/MIP, Hungarian assignment, Monte Carlo, host diagnostics, sandboxed code generation with green `node --test` evidence, security scanning), scoped memory with audit, virtual organization building, and four new worlds in the UI: **مركز التنفيذ** (`#execution`), **الوكلاء والمنظمات** (`#agents`), **الذكاء التشغيلي** (`#intelligence`) and **النظام** (`#system`). The persistent **Executive Command** bar launches real missions.

Verified end-to-end on this branch: computer-diagnostics mission, agent creation mission, web-app build mission (generate → scan → independent QA, all green), organization build from one objective, and the 20 employees × 5 shifts cost-minimizing schedule (total cost 480). See **docs/OS_CORE.md** for the full engineering record, architecture decisions, security model and honest list of what is not implemented.

```bash
# exercise the OS API directly
curl -X POST http://localhost:4000/api/os/missions -H 'content-type: application/json' \
  -d '{"objective":"Inspect my computer and identify potential problems"}'
curl http://localhost:4000/api/os/state
curl http://localhost:4000/api/os/playbooks   # WORA-built, re-validated optimization playbooks
curl http://localhost:4000/api/os/usage       # AI token/cost ledger (admin-key in production)
```

State is persisted under `WORA_OS_DB` (default `api-server/data/wora-os.db`, SQLite via `node:sqlite`); generated apps, reports and mission artifacts live under `WORA_WORKSPACE` (default `api-server/data/workspace`). Both are git- and docker-ignored.

SQLite is a single-writer store. Run exactly **one** API replica against the `os-data` volume. On startup the API takes a heartbeat lease on the database and a second process fails fast instead of competing for writes or marking another process's missions interrupted. Scaling the API horizontally requires moving the OS store to PostgreSQL first. Workspace file access canonicalizes paths and rejects symlink escapes; `web.fetch_read` rejects loopback, private, link-local, reserved and metadata destinations, pins DNS resolution, revalidates redirects, and caps response size. Local marketplaces are limited to `WORA_EXTENSIONS_LOCAL_ROOTS` and reject symlink escapes.

## Run the workspace

Use Node.js 22.18 or later and npm. To explore the client without external services:

```bash
cd client
npm ci
npm run dev
```

Open `http://localhost:5173`. Without an API, Wora uses the local office and simulated replies. Add the optional in-memory server for a connected preview:

```bash
# In a second terminal, from the repository root
cd api-server
npm ci
npm run dev:preview
```

The client proxies `/api`, `/health`, `/ready`, and `/socket.io` to port 4000. The preview API seeds four agents and four server-backed departments; the map still includes all ten departments. Connected snapshots replace the starter roster; neither preview starts with fabricated activity or completed tasks. Assignments in server-backed departments are confirmed by the preview API and held in memory. Assignments to a session-local agent or a department the API does not support are marked local. Chats from either preview always simulate replies, even if provider keys happen to be present. The director never simulates work as completed.

## Architecture

```text
wora-agent-os/
├── client/                 # React 18, Vite 6, Zustand and CSS design tokens
│   └── src/
│       ├── components/     # Workbench, director, interactive office and projects
│       ├── office/         # Spatial geometry, matching, reporting, and local movement
│       ├── hooks/          # Socket.IO connection and offline fallback
│       ├── skills/         # Typed GitHub skill registry client
│       └── styles/         # Responsive RTL layout, light/dark themes and shared UI
├── api-server/             # Express 5, Socket.IO, Redis, BullMQ and MongoDB
│   └── src/os/             # WORA OS core: orchestrator, registry, tools, OR solvers, memory, organizations
├── shared/types/           # Shared backend contracts and model registry
├── design-concepts/        # Original office design references
├── nginx/                  # Reverse proxy configuration
└── docker-compose.prod.yml   # includes the persistent `os-data` volume for WORA OS records
```

## Verification

```bash
npm --prefix client ci
npm --prefix client test
npm --prefix client run build
npm --prefix api-server ci
npm --prefix api-server run typecheck
npm --prefix api-server test
npm --prefix api-server run build
```

For the optional real-MongoDB catalog test, set `WORA_TEST_MONGO_URL` to a **disposable test MongoDB instance**. The test creates and drops its own database.

With the preview API running, verify the production client locally with `npm --prefix client run preview`:

- Open `/` to go straight to the workbench. Enlarge and restore the map with Escape, visit a department from the map and room selector, then switch to the floor plan. Try direct links `/#campus/zone-engineering` and `/#director`. Rooms can be visited even when a plan restricts assignments. Check the mobile menu, keyboard focus, and both themes at 320px and wider.
- From Help, start the optional tour, move forward and back, and return to the full map. With reduced motion enabled, the visitor should arrive immediately without a camera animation.
- Use <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd> to find a department, screen, or agent. Select an agent, then use its follow control or open its chat.
- In the director’s office, request **ملخّص الساحة**. Send **اختبر التسجيل من الموبايل**, check Sentinel’s recommendation and reason, and confirm it. Open the acknowledged task and request another summary to see the change. Try a locked-room request in Free. Add a session-local agent or change an agent’s model in the team panel.
- Select a connected agent in the team panel, open **مهارات GitHub**, and choose **استيراد من GitHub**. Use `https://github.com/octocat/Spoon-Knife` to verify inactive review and explicit activation. The test suite also covers `skill.json` with required inputs.
- Create a project and move a task with the stage dropdown. In the Studio, activate the local Pro preview, try an example brief, and edit a draft. Save one draft (or the pack) to a project, reload, and confirm the edit and the project link persist without duplicates. Download the pack and reopen an earlier pack from its history.
- Filter the model and integration catalogues. Connect, sync, and disconnect a demo integration; no external account should be opened.

## Director's office

The assistant answers status requests from the current workspace task records and the labeled activity of the browser session. It does not extrapolate completed work from agent presence or movement. Reports are a snapshot, not a cross-workspace audit history. Recommendations use the available roster, matched skills, and open workload. The assistant asks for more detail if it cannot find a match, and cannot assign a task until the user confirms an eligible recipient. The local Pro control is a preview UI gate, not a production entitlement.

- With an expiring signed session and an enabled Studio provider/model (`STUDIO_PROVIDER` and `STUDIO_MODEL`), the production API can use that model to rank the short list. It validates the chosen agent and the cited profile skill or role. If unavailable or the model gives an invalid answer, the assistant uses local matching. Reports never go to a provider.
- A confirmed task is saved to the user's room and assigned to the recommended agent. In production, a signed session and that agent’s configured provider allow the API to queue **one text response**. No integrations, file changes, or other external actions are invoked. The response is attached to the task for review, not counted as completed. A missing provider or failed run is displayed separately from a saved assignment. The preview only records assignments, without claiming that the assigned work ran.
- Each new provider path is bounded separately (6 requests per minute per user, 90 per hour across the deployment), with Redis quota checks and provider timeouts. The preview API stores assignments in memory, the production task board uses its existing scoped Redis storage (24-hour task visibility), and standalone assignments last in the browser session.

## GitHub skill registry

Only public GitHub repository URLs of the form `https://github.com/owner/repo` are accepted. The API uses Octokit to read the repository's public visibility and then **root `skill.json`** or, if that file is absent, its **README**. A descriptor looks like this:

```json
{
  "name": "Note Summary",
  "description": "Summarize a plain text note.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "note": { "type": "string" },
      "language": { "enum": ["ar", "en"] }
    },
    "required": ["note"],
    "additionalProperties": false
  }
}
```

`input_schema` and `parameters` are accepted as descriptor aliases. For README imports, use a `json` fenced block with the descriptor or an explicit object input schema. Otherwise Wora takes the heading and first descriptive paragraph and reports that no input schema was declared. It does not guess missing inputs from code. The review shows the source file and blob SHA, required/optional inputs, and the full schema as text. Invalid descriptors return a validation error rather than silently replacing declared inputs. JSON Schema references are not dereferenced.

- `GET /api/agents/:agentId/skills` reads the signed workspace's catalog; `POST /api/agents/:agentId/skills/import-github` with `{ "url": "…" }` saves an inactive draft, returning its `skillId`. Re-importing a normalized repository returns the existing record. `PATCH /api/agents/:agentId/skills/:skillId` with `{ "active": true }` explicitly activates it; `false` deactivates it.
- Production requires an expiring `AUTH_SECRET` session and MongoDB. The `AgentSkillSet` collection links to `AgentModel` by agent ID and is keyed by **workspace and agent**, rather than adding one user's skills to the shared `AgentModel.profile`. Revisioned writes avoid lost toggles and duplicates. Socket.IO emits `agent:skills-updated` only to that workspace, and `room:state` hydrates counts on reconnect. The public agent catalog does not include these private records.
- Imports are limited to 12 repositories per agent, 4 imports per user per minute, 3 concurrent imports per API process, 64 KiB per metadata file, and a 7.5-second GitHub deadline. Redis applies a shared hourly quota in production. Optional **`GITHUB_SKILLS_TOKEN`** increases the budget; use a server-only token with no private repository access. Never add it to `VITE_*` or paste it into the app.
- The sandbox API issues a separate signed preview session and keeps skills in memory. They survive reload/reconnect within a preview session, not a server restart. Standalone/static and session-local agents cannot import. **Activation only registers reviewed metadata.** Wora does not clone, install, run, or prompt a model with repository contents.

## Preview vs. production

Projects, ideas, products, project Kanban tasks, and the last ten Studio packs are saved in this browser. They are not synced across devices. Newly hired agents are session-local, the Pro preview never charges, and integration demos do not contact external services. The standalone client and preview API stay in local-template mode for Studio. Studio never publishes products. The model catalogue is a reference; actual inference depends on the server-supported provider and deployment settings. Configure AI credentials on the server only; the web client does not collect or store provider keys. If you entered a real key in the previous client’s local key UI, remove the old `wora:byok` entry from site storage and rotate that key with the provider.

A Vercel deployment of `client/` without an API origin is the standalone preview, not the connected service. Do not expose the in-memory preview API as a production service. The connected API stores up to 100 recent messages per workspace in Redis (7-day inactivity TTL) and Director task entries for 24 hours. Permanent project records should not depend on those temporary API stores. Real subscriptions, third-party OAuth and Studio publishing are not implemented.

## Product Studio: templates and optional live generation

Studio turns a brief with an optional audience and pricing position into three editable draft products and a short pre-launch checklist. Price, cost, and margin are estimates in USD. Users can copy or download a UTF-8 text pack, and save one or all drafts to a project. A second save updates an existing linked **draft** rather than duplicating it; products already moved out of draft status are managed in Projects. Removing a pack from the local history does not remove saved project products.

For live generation on the **production API**:

1. Set `STUDIO_PROVIDER` to `google`, `openai`, `anthropic`, or `groq` and supply its matching API key on the server. Optionally set `STUDIO_MODEL` to a supported model listed by `/api/brains`; otherwise the first supported model for that provider is used.
2. Open a signed workspace session as described below. The same session authorizes Studio, room access and the skill registry. Never put a session, signing secret or provider key in a `VITE_*` variable.
3. Use the same-origin `/api` proxy, or set `VITE_API_URL` to your API's HTTPS origin and allow the app origin in `ALLOWED_ORIGINS`. `/api/os` and `/api/os/extensions` follow `VITE_API_URL`; set `VITE_OS_API` only when those routes live on a different origin. `npm run build` fails if the Docker/compose/env files drift from this contract.

`GET /api/studio/status` reports live availability for the current signed session. `POST /api/studio/drafts` accepts only the brief with a bearer session, enforces a 4-per-minute quota per user and a shared 60-per-hour deployment quota in Redis, and times out provider calls. Redis quota failures refuse the call rather than sending unmetered requests. Both routes use `Cache-Control: no-store`. Provider output is validated before being returned, and the UI offers local templates if direct generation fails. Only the live mode forwards the brief to the configured provider; generated packs are saved in the browser, not by the Studio API. The local Pro switch is a preview UI switch, not authentication or a production billing entitlement.

## Connected deployment and launch checks

The production API must be a long-lived service that supports WebSockets, not a Vercel static deployment. Normal startup fails closed without a strong `AUTH_SECRET`, `MONGO_URI`, `REDIS_URL`, and explicit `ALLOWED_ORIGINS`. Use a random signing secret of at least 32 bytes (for example `openssl rand -hex 32`). A separate random `ADMIN_API_KEY` is optional; without it global model edits are disabled. Keep secrets in the API host environment, not in Git or the frontend. `npm run dev` is explicitly local development; use `npm start` in hosting.

### Docker Compose

1. Copy `.env.example` to an untracked `.env`. Set MongoDB, a random Redis password (hex works in the Compose URI), the session secret, and the exact HTTPS frontend origin. Set the TLS certificates in `nginx/ssl/fullchain.pem` and `nginx/ssl/privkey.pem` and the domain in `nginx/nginx.conf`.
2. Run `docker compose -f docker-compose.prod.yml up -d --build`.
3. For a **new** database only, run `docker compose -f docker-compose.prod.yml exec api node dist/seed.mjs`. Seeding updates the four core agent configurations; do not reset or reseed an existing catalog as part of a release.

### Vercel frontend with Railway or another API host

1. Deploy `api-server/Dockerfile` with the repository root as build context. Attach persistent Redis (`noeviction`) and MongoDB. Set `MONGO_URI`, `REDIS_URL`, and `AUTH_SECRET`. Set `ALLOWED_ORIGINS` to the frontend's **exact origin** (scheme and host, no trailing slash). Initialize a new catalog with `node dist/seed.mjs`.
2. Enable HTTPS and `/socket.io` on the API host. On `client/` in Vercel, set the **public** API origin in `VITE_API_URL` and redeploy. The OS and extensions clients now use that same origin; set `VITE_OS_API` only if `/api/os` is served elsewhere. `VITE_SOCKET_URL` is only needed when the socket origin differs. For one HTTPS origin with a reverse proxy, leave all three empty. Do not run more than one API replica while the OS database is SQLite.
3. Supply provider keys server-side for the models you plan to use. For the default roster, the first general-chat reply goes to Aria (Google/Gemini); you can select a different agent or use a room-level model swap. Unconfigured agents can record assignments but cannot generate live replies. Live Studio and model-assisted Director recommendations also require `STUDIO_PROVIDER` and its key. Do not use a preview provider key or integration demo as evidence of a live connection.

### Open a private workspace

From a trusted terminal on the **API** host with its signing secret already configured, issue a temporary session using the production build:

```bash
node dist/issue-session.mjs owner-workspace 120
# Compose: docker compose -f docker-compose.prod.yml exec api node dist/issue-session.mjs owner-workspace 120
```

Use a unique, stable ID per workspace; reusing it reopens that workspace. The optional lifetime is in minutes (default 120, range 1–480). Supply the generated code privately to the intended user. In Wora, open **الإعدادات → جلسة مساحة العمل**, enter the code, and choose **اتصال بمساحة العمل**. The browser verifies the code against the API and saves it in the current tab's session storage. **إنهاء الجلسة في المتصفح** clears it from the browser; already issued codes are usable until expiry unless the API signing secret is rotated. It's an operator-issued access flow, not a public registration or password reset system. Existing expiring HMAC/HS256 identity integrations can still supply sessions. Previously signed tokens without `exp` must be reissued before production rollout.

### Verify before calling the service live

- `GET /health` on the API should return `200`, `mode: production`, and healthy Redis and MongoDB. `GET /ready` must also return `200`, `status: ready`, `sessions: signed`, and `roster: seeded`. `ai: configured` means at least one active agent has a configured key, **not** that a provider has passed a real request. An anonymous `GET /api/session` should give `401`. A standalone Vercel frontend will not serve these API probes.
- Open a signed session, send a real chat, and reload to check the reply and history. In a different workspace, confirm the first workspace's history, assignments, and skills are invisible. Confirm a Director assignment and check the draft appears for review; reaching review does not mean the work has been completed.
- Save and reload a Studio pack in Projects, verify it doesn't duplicate the saved draft, and export it. If live Studio is configured, make one real signed request and verify the application labels it live. Confirm Projects persist in the same browser. Do not expect cross-device sync, payments, or published products.
- Keep the previous deploy available for rollback. If updating an existing connected API, back up MongoDB and Redis and validate the new environment and expiring sessions before routing traffic. Do not wipe browser or server storage to roll back.
