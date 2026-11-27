# WORA V1 — Production Deployment and Operations

This is the deployment contract for the consolidated V1 release candidate. It
describes the verified code path and the exact external configuration that must
be supplied. It is not a claim that Docker, MongoDB, Redis, TLS or a production
host were exercised in the build environment used for this release candidate.

## 1. Runtime boundary

```
Internet ──TLS──> nginx ──> api (public API, no host Docker socket)
                              │
                              ├── MongoDB (state + agent registry)
                              ├── Redis (sessions, queues, Socket.IO)
                              ├── os-data volume (SQLite OS store + keyring)
                              ├── runtime-data volume (session workspaces/artifacts)
                              └── TLS ──> runtime-docker (dedicated DinD)
                                             ├── cloud computer containers
                                             └── isolated Chromium containers
                              │
                         os-worker (same os-data and runtime-data volumes)
```

- The API receives `DOCKER_HOST=tcp://runtime-docker:2376` with TLS. It never
  mounts `/var/run/docker.sock`.
- `runtime-docker` is privileged because it is a dedicated daemon, isolated on
  `wora-runtime-net` and reachable only by WORA services. Do not reuse a host
  Docker daemon for this role.
- The browser proxy is a per-session Unix socket in `runtime-data`; only the
  browser container mounts it. The container bridges it to Chromium on loopback.
- `os-worker` is a separate process, not an API replica. SQLite remains a
  single-writer store; run one API and one worker against one `os-data` volume.

## 2. External prerequisites

Required and not supplied by the repository:

1. Linux host with Docker Engine and permission to run a privileged DinD
   container (or an equivalent dedicated Docker runtime endpoint with TLS).
2. MongoDB replica set or a managed MongoDB URI.
3. Redis 7+ with a password and TLS if it crosses an untrusted network.
4. A public DNS name and TLS certificate for nginx (`nginx/ssl/fullchain.pem`,
   `nginx/ssl/privkey.pem`).
5. Node.js 22.18+ for non-container development and CI. The release was tested
   on Node 22.23.5 and Node 24.22.2.
6. Git on the API and worker hosts; marketplace synchronization executes
   `git` through a constrained command surface.
7. A kernel/container profile that permits Chromium's user-namespace/setuid
   sandbox. If the probe fails, `/ready` and browser sessions fail closed.
8. Outbound network access from `runtime-docker` for the initial
   `node:22-alpine` pull and browser image build. Pin an internal registry if
   the deployment has no public egress.

## 3. Configure `.env`

Copy `.env.example` to `.env` and set at minimum:

```dotenv
AUTH_SECRET=<32+ random bytes>
ADMIN_API_KEY=<separate random value>
MONGO_URI=mongodb://...
REDIS_PASSWORD=<random value>
ALLOWED_ORIGINS=https://wora.example.com
WORA_OS_WORKSPACE_ID=<the workspace used by missions>
```

The runtime block in `.env.example` is already aligned with
`docker-compose.prod.yml`:

```dotenv
WORA_API_IMAGE=wora-api:release
WORA_CLOUD_PROVIDER=docker
WORA_BROWSER_PROVIDER=docker
WORA_CLOUD_IMAGE=node:22-alpine
WORA_BROWSER_IMAGE=wora-browser-runtime:1.0.0
WORA_RUNTIME_ROOT=/app/data/runtime
DOCKER_HOST=tcp://runtime-docker:2376
DOCKER_TLS_VERIFY=1
DOCKER_CERT_PATH=/certs/api
WORA_SECRET_KEY_FILE=/app/data/.wora-secret-key
```

Do not put provider API keys, Docker certificates, MongoDB passwords or the
keyring in Git. `keyring-init` creates the keyring with mode `0600` once. Back it
up separately from `os-data`; losing it makes encrypted stored secrets
unreadable.

## 4. Build and start

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

Startup order enforced by compose:

1. Redis healthy.
2. `keyring-init` completes and creates the keyring if absent.
3. `runtime-docker` healthy.
4. `runtime-certs-init` copies the client certificates to a 0600 directory
   owned by the non-root API user.
5. `runtime-bootstrap` pulls `node:22-alpine` and builds the browser image.
6. API and `os-worker` start.

The API fails fast at boot when production runtime settings are missing or
unsafe. This is intentional; do not bypass it with a process provider.

Seed the agent roster once (after MongoDB is reachable):

```bash
docker compose -f docker-compose.prod.yml exec api node dist/seed.mjs
```

## 5. Verification

```bash
curl -fsS https://wora.example.com/health
curl -fsS https://wora.example.com/ready
```

`/ready` must report:

- MongoDB and Redis connected.
- `runtime.operational: true` with the Docker provider and isolated runtime.
- `browser.available: true` with `provider: docker`, `isolated: true` and the
  expected Chromium sandbox mode.

If `/ready` is `503`, read the response fields and API startup logs. Do not
disable the runtime checks to make readiness green.

## 6. Persistence and backup

| Volume | Contents | Backup |
| --- | --- | --- |
| `os-data` | SQLite OS DB, workspace, keyring | Stop API/worker, copy the volume or use SQLite `.backup`; copy the keyring separately. |
| `runtime-data` | Session workspaces, screenshots, research documents | Copy while sessions are stopped; artifacts are files referenced by SQLite. |
| `runtime-docker-data` | Runtime daemon images and container layers | Rebuildable; no business data required. |
| `redis-data` | Queue/session cache | Not the source of truth; back up only for faster recovery. |

Restore order: `os-data` + keyring + `runtime-data`, then Redis, then start API
and worker. Never restore a SQLite file while a writer is running.

## 7. Rollback

1. `docker compose -f docker-compose.prod.yml down` (keep volumes).
2. Deploy the previous image tag with the same volumes and keyring.
3. If a migration must be reversed, use the repository's versioned migration
   rollback path; do not delete `os-data` or edit SQLite manually.
4. Re-run `/health` and `/ready` before accepting traffic.

Runtime containers and the browser proxy socket are cleaned at boot/stop. If a
host crash leaves orphaned containers, `recoverRuntimeSessions` marks sessions
interrupted and releases provider resources; it does not claim them completed.

## 8. Operational limits

- One API replica while the OS store is file-backed SQLite.
- One `os-worker` per database unless serialized writes are acceptable.
- No PostgreSQL adapter, distributed mission lease, or horizontal scheduler in
  V1.
- Project-level ACLs are not a first-class runtime entity; project capability
  rows exist, but agent/project isolation currently relies on workspace and
  agent scope. Treat this as a known limitation.
- Docker, MongoDB, Redis, nginx TLS and a real Chromium sandbox were not
  available in the release-candidate build environment. Their integration
  tests are present and skipped locally; run them on the deployment host before
  declaring production live.
