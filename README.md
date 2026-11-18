# Wora Agent OS

Wora is an Arabic-first workspace for operating an AI team. It opens directly in the working area: a ten-department model or floor plan, the live roster, and the department task board. **Enlarge workspace** hides the surrounding navigation and gives the map the available screen; **Escape** or the same control restores it. On narrow screens, the enlarged model is horizontally scrollable. The optional tour is under **Help**. The director's office is available from the map and the main navigation.

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

The client proxies `/api`, `/health`, and `/socket.io` to port 4000. The preview API seeds four agents and four server-backed departments; the map still includes all ten departments. Connected snapshots replace the starter roster; neither preview starts with fabricated activity or completed tasks. Assignments in server-backed departments are confirmed by the preview API and held in memory. Assignments to a session-local agent or a department the API does not support are marked local. Ordinary chats from the preview server simulate replies when no provider is configured; the director never simulates work as completed.

## Architecture

```text
wora-agent-os/
├── client/                 # React 18, Vite 6, Zustand and CSS design tokens
│   └── src/
│       ├── components/     # Workbench, director, interactive office and projects
│       ├── office/         # Spatial geometry, matching, reporting, and local movement
│       ├── hooks/          # Socket.IO connection and offline fallback
│       └── styles/         # Responsive RTL layout, light/dark themes and shared UI
├── api-server/             # Express 5, Socket.IO, Redis, BullMQ and MongoDB
├── shared/types/           # Shared backend contracts and model registry
├── design-concepts/        # Original office design references
├── nginx/                  # Reverse proxy configuration
└── docker-compose.prod.yml
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

With the preview API running, verify the production client locally with `npm --prefix client run preview`:

- Open `/` to go straight to the workbench. Enlarge and restore the map with Escape, visit a department from the map and room selector, then switch to the floor plan. Try direct links `/#campus/zone-engineering` and `/#director`. Rooms can be visited even when a plan restricts assignments. Check the mobile menu, keyboard focus, and both themes at 320px and wider.
- From Help, start the optional tour, move forward and back, and return to the full map. With reduced motion enabled, the visitor should arrive immediately without a camera animation.
- Use <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd> to find a department, screen, or agent. Select an agent, then use its follow control or open its chat.
- In the director’s office, request **ملخّص الساحة**. Send **اختبر التسجيل من الموبايل**, check Sentinel’s recommendation and reason, and confirm it. Open the acknowledged task and request another summary to see the change. Try a locked-room request in Free. Add a session-local agent or change an agent’s model in the team panel.
- Create a project and move a task with the stage dropdown. In the Studio, activate the local Pro preview, try an example brief, and edit a draft. Save one draft (or the pack) to a project, reload, and confirm the edit and the project link persist without duplicates. Download the pack and reopen an earlier pack from its history.
- Filter the model and integration catalogues. Connect, sync, and disconnect a demo integration; no external account should be opened.

## Director's office

The assistant answers status requests from the current workspace task records and the labeled activity of the browser session. It does not extrapolate completed work from agent presence or movement. Reports are a snapshot, not a cross-workspace audit history. Recommendations use the available roster, matched skills, and open workload. The assistant asks for more detail if it cannot find a match, and cannot assign a task until the user confirms an eligible recipient. The local Pro control is a preview UI gate, not a production entitlement.

- With an expiring signed session and an enabled Studio provider/model (`STUDIO_PROVIDER` and `STUDIO_MODEL`), the production API can use that model to rank the short list. It validates the chosen agent and the cited profile skill or role. If unavailable or the model gives an invalid answer, the assistant uses local matching. Reports never go to a provider.
- A confirmed task is saved to the user's room and assigned to the recommended agent. In production, a signed session and that agent’s configured provider allow the API to queue **one text response**. No integrations, file changes, or other external actions are invoked. The response is attached to the task for review, not counted as completed. A missing provider or failed run is displayed separately from a saved assignment. The preview only records assignments, without claiming that the assigned work ran.
- Each new provider path is bounded separately (6 requests per minute per user, 90 per hour across the deployment), with Redis quota checks and provider timeouts. The preview API stores assignments in memory, the production task board uses its existing scoped Redis storage (24-hour task visibility), and standalone assignments last in the browser session.

## Preview vs. production

Projects, ideas, products, project Kanban tasks, and the last ten Studio packs are saved in this browser. They are not synced across devices. Newly hired agents are session-local, the Pro preview never charges, and integration demos do not contact external services. The standalone client and preview API stay in local-template mode for Studio. Studio never publishes products. The model catalogue is a reference; actual inference depends on the server-supported provider and deployment settings. Configure AI credentials on the server only; the redesigned client does not collect or store provider keys. If you entered a real key in the previous client’s local key UI, remove the old `wora:byok` entry from site storage and rotate that key with the provider.

For a public release, configure production access control, data persistence, and supported AI providers. Any real subscription, OAuth integration, or Studio publishing workflow needs separate backend implementation and end-to-end verification. Do not expose the in-memory preview API as a production service.

## Product Studio: templates and optional live generation

Studio turns a brief with an optional audience and pricing position into three editable draft products and a short pre-launch checklist. Price, cost, and margin are estimates in USD. Users can copy or download a UTF-8 text pack, and save one or all drafts to a project. A second save updates an existing linked **draft** rather than duplicating it; products already moved out of draft status are managed in Projects. Removing a pack from the local history does not remove saved project products.

For live generation on the **production API**:

1. Set `STUDIO_PROVIDER` to `google`, `openai`, `anthropic`, or `groq` and supply its matching API key on the server. Optionally set `STUDIO_MODEL` to a supported model listed by `/api/brains`; otherwise the first supported model for that provider is used.
2. Set a strong `AUTH_SECRET` and supply a signed workspace session from your identity layer. Live Studio requires a valid `exp` claim on the existing HMAC/HS256 session format. The web client reads the deployment's short-lived session from `sessionStorage` at `wora:authToken` (with the existing local storage fallback). There is no user sign-in or token-issuing flow bundled here. Never put a session, signing secret, or provider key in a `VITE_*` variable.
3. Use the same-origin `/api` proxy, or set `VITE_API_URL` to your API's HTTPS origin and allow the app origin in `ALLOWED_ORIGINS`.

`GET /api/studio/status` reports live availability for the current signed session. `POST /api/studio/drafts` accepts only the brief with a bearer session, enforces a 4-per-minute quota per user and a shared 60-per-hour deployment quota in Redis, and times out provider calls. Redis quota failures refuse the call rather than sending unmetered requests. Both routes use `Cache-Control: no-store`. Provider output is validated before being returned, and the UI offers local templates if direct generation fails. Only the live mode forwards the brief to the configured provider; generated packs are saved in the browser, not by the Studio API. The local Pro switch is a preview UI switch, not authentication or a production billing entitlement.

## Production deployment

### Docker Compose

```bash
cp .env.example .env
# Set MongoDB, Redis, allowed frontend origins, authentication, and any AI provider settings.
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec api node dist/seed.mjs
```

### Railway or separate hosts

1. Deploy `api-server` from the repository root using `api-server/Dockerfile`.
2. Attach Redis and MongoDB. Configure `MONGO_URI`, `REDIS_URL`, `ALLOWED_ORIGINS`, `ADMIN_API_KEY`, and production authentication. Set optional AI provider keys in the API service environment, never in Vite variables.
3. Seed the four core agents by running `node dist/seed.mjs` once.
4. Deploy the client from `client/`. If the API is not behind the same origin, set `VITE_API_URL` and `VITE_SOCKET_URL` to the public API URL at build time.
