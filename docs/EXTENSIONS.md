# WORA Extensions: Skills, Plugins, Marketplaces and MCP

This document describes the implemented extensions subsystem. It is not a roadmap: every item here
is backed by code and tests in `api-server/src/extensions`, `api-server/src/os`, and `client/src/extensions`.

## 1. Where it lives

| Concern | Module |
|---|---|
| Tables and indexes | `api-server/src/extensions/schema.ts` |
| Manifest schemas, validation, permission catalogue | `api-server/src/extensions/manifest.ts` |
| Encrypted secrets | `api-server/src/extensions/secrets.ts` |
| Persistence (packages, versions, installs, tools, MCP, audit, snapshots) | `api-server/src/extensions/store.ts` |
| Git fetching and safe path handling | `api-server/src/extensions/git.ts` |
| Marketplace registration, preview and synchronization | `api-server/src/extensions/marketplace.ts` |
| Dependency resolution and install plans | `api-server/src/extensions/resolver.ts` |
| MCP stdio/HTTP child-process client | `api-server/src/extensions/mcp.ts` |
| Plugin runtime: health, tool registration, execution | `api-server/src/extensions/runtime.ts` |
| Capability resolution, tool authorization, snapshots | `api-server/src/extensions/capabilities.ts` |
| Built-in WORA catalog (19 skills + echo MCP reference plugin) | `api-server/src/extensions/builtin.ts` |
| REST surface | `api-server/src/extensions/router.ts` |
| Agent tool provider hook | `api-server/src/os/tools.ts` |
| Orchestrator enforcement and snapshots | `api-server/src/os/orchestrator.ts` |
| UI | `client/src/components/ExtensionsHub.tsx`, `AgentCapabilitiesDialog.tsx` |

The extension tables live in the existing SQLite OS database (`WORA_OS_DB`). There is no second database
and no parallel registry.

## 2. Manifest standards

Manifests are JSON documents with `schema_version: "1.0"`. Unknown fields are rejected (strict Zod
objects) so a package cannot smuggle an execution mechanism the validator did not review.

### Skill

```json
{
  "schema_version": "1.0",
  "id": "wora.backend-engineering",
  "name": "Backend Engineering",
  "version": "1.0.0",
  "type": "knowledge",
  "description": "Backend engineering standards and workflows",
  "author": "WORA",
  "category": "engineering",
  "tags": ["backend"],
  "capabilities": ["backend_development", "api_design"],
  "permissions": ["repository.read"],
  "scope": ["instance", "project", "agent"],
  "dependencies": [{ "id": "wora.software-architecture", "version": "^1.0.0" }],
  "auto_load": false,
  "instructions": "# Responsibility\n...",
  "requirements": { "tools": ["github", "terminal"], "permissions": ["repository.read"], "secrets": [] },
  "verification": ["Evidence attached to the handoff"],
  "failure_handling": "Report the failing step and stop.",
  "handoff": "Hand the verified result to the requesting agent."
}
```

Skills are instructions, never programs. Nothing executes because a skill is installed. A skill is
resolved into the agent's capability profile with its instruction digest.

### Plugin

```json
{
  "schema_version": "1.0",
  "id": "wora.playwright",
  "name": "Playwright Integration",
  "version": "1.0.0",
  "type": "mcp",
  "description": "Browser automation and testing",
  "author": "WORA",
  "permissions": ["browser.navigate", "browser.interact"],
  "scope": ["instance", "agent"],
  "entrypoint": { "transport": "stdio", "command": "npx", "args": ["-y", "@playwright/mcp"], "env": [] },
  "required_secrets": [],
  "configuration": {},
  "tools": [],
  "health": { "type": "mcp", "timeout_ms": 8000 },
  "security": { "risk_level": "medium", "network": true, "data_access": ["browser"] }
}
```

Plugin types and isolation:

| Type | Execution | Isolation |
|---|---|---|
| `mcp` + `stdio` | child process (`command`/`args`) | separate process, filtered env, no shell |
| `mcp` + `http` | remote MCP endpoint | network call |
| `http` | declared HTTP tools | network call with origin pinning |
| `native` | refused | no in-process plugin code |

Commands are allowlisted (`node`, `npx`, `python3`, `uvx`, `docker`, `deno`, `bun`). Shell
metacharacters, `-e`, `--eval`, `curl`, `wget`, `bash`, `sh` and inline evaluation are rejected.
Lifecycle hooks are not supported and are rejected as unknown fields.

## 3. Lifecycle

1. **Register** a marketplace (`POST /extensions/marketplaces`) with a Git URL, ref, optional
   repository path, trust level, auto-load flag and optional credential.
2. **Synchronize** (`POST /extensions/marketplaces/:id/sync`). The commit is fetched into a private
   cache, manifests are discovered under `wora/skills|plugins` and `skills|plugins`, validated, and
   stored. Invalid manifests are logged and skipped. Published versions are immutable: republishing the
   same version with different content is refused. Packages that disappear are marked `revoked` unless
   installed, in which case they are marked `missing` and remain installed until explicitly removed.
3. **Inspect** a package and its security review (`GET /extensions/packages/:id`).
4. **Plan** (`POST /extensions/packages/:id/plan`) to see dependencies, missing packages, conflicts,
   cycles, missing tools/secrets, permissions and whether approval is required.
5. **Install** (`POST /extensions/packages/:id/install`) at `instance`, `organization`, `project`,
   `agent` or `user` scope. Installation is transactional; dependencies are installed in the same
   transaction. Sensitive/unknown permissions and code-executing plugins require
   `approvePermissions: true`.
6. **Enable** (`POST /extensions/installations/:id/enable`) registers tools and starts MCP health
   discovery. Skills never start anything.
7. **Disable** (`POST /extensions/installations/:id/disable`) revokes capability immediately.
8. **Update / roll back** (`POST .../update`, `.../rollback`) between published versions.
9. **Uninstall** (`DELETE /extensions/installations/:id`) refuses while a dependent package is
   installed, then deletes tool and MCP registrations.

Auto-load (`auto_load`, marketplace `autoLoad`, agent policy `autoLoad`) only controls whether approved
metadata appears in the resolved profile's `autoLoad` lists. It never executes code and never installs a
package.

## 4. Capability resolution and authorization

`resolveCapabilities(workspaceId, agentId)` merges:

- installations visible to the agent (`instance`, matching organization/project/agent/user scope);
- agent policy: `deniedPackages`, `deniedTools`, `deniedPermissions`, `extraPermissions`, `autoLoad`;
- agent permissions and tool list;
- skill requirements (tools, permissions, secrets) and plugin requirements.

Anything unmet becomes a `blocked` entry with a reason. Deny always wins. Disabled, revoked, missing or
unapproved installations are blocked.

When the orchestrator runs a task it resolves on **every attempt**, records a `capability_snapshots` row
with a SHA-256 digest, and passes only the resolved permissions and tools to the tool context. A plugin
tool is additionally authorized against the resolved profile; direct calls to the generic
`/api/os/tools/:id/execute` endpoint are refused for plugin tools (`403 CAPABILITY_REQUIRED`).

## 5. Secrets

Secrets are AES-256-GCM encrypted at rest with a key derived from `AUTH_SECRET` (or a 0600 key file
`WORA_EXT_KEY_FILE`). Listing returns metadata only. The plaintext is revealed only inside the runtime
when a plugin needs it, and never appears in API responses, audit details, logs or agent context.
Marketplace credentials are stored as secrets and exposed only as `secretConfigured: true`.

## 6. Database tables

`ext_marketplaces`, `ext_marketplace_syncs`, `ext_packages`, `ext_package_versions`,
`ext_dependencies`, `ext_installations`, `ext_tools`, `ext_mcp_servers`, `ext_secrets`,
`ext_audit`, `ext_agent_policies`, `ext_capability_snapshots`.

All tables carry `workspace_id`, foreign keys, unique constraints and indexes. Tenant isolation is
enforced in every query.

## 7. API surface (`/api/os/extensions`, all server-authorized)

- `GET /` summary, `GET /permissions`, `GET /packages`, `GET /packages/:id`,
  `GET /packages/:id/versions`
- `POST /packages/:id/plan`, `POST /packages/:id/install`, `POST /packages/:id/revoke`
- `GET /installations`, `GET /installations/:id`, `POST /installations/:id/approve|enable|disable|update|rollback|health`,
  `DELETE /installations/:id`
- `GET /marketplaces`, `POST /marketplaces`, `POST /marketplaces/preview`, `GET /marketplaces/:id`,
  `PATCH /marketplaces/:id`, `DELETE /marketplaces/:id`, `POST /marketplaces/:id/sync`,
  `GET /marketplaces/:id/syncs`
- `GET /tools`, `GET /mcp`, `POST /mcp/:id/health`
- `POST /validate`, `POST /packages/create`
- `GET /agents/:agentId/capabilities`, `PUT /agents/:agentId/policy`,
  `POST /agents/:agentId/resolve`, `POST /agents/:agentId/tools/:toolId/execute`
- `GET /secrets`, `POST /secrets`, `DELETE /secrets/:name`
- `GET /audit`, `GET /snapshots`

Roles: `viewer` read-only; `member` install/enable/disable/update/uninstall/assign/create-package;
`admin`/`owner` marketplace, secrets, approval, policy grants. RBAC is enforced by the existing OS role
middleware before the router, and again inside the router for admin-only routes.

## 8. UI

`#extensions` (nav label "المهارات والإضافات") provides:

- Skills and Plugins tabs with search, category/marketplace/scope filters, installed/enabled filters.
- Package details: description, version, author, source, checksum, capabilities, permissions,
  dependencies, required tools, security review, version history, installations, enable/disable,
  update, rollback, uninstall.
- Install dialog with scope/target/version selection, live install plan, blockers and explicit approval.
- Marketplaces tab: add repository (URL, ref type/ref, path, trust, auto-load, credential), preview,
  sync, remove, health, package count and last sync.
- Tools & MCP tab: plugin tools with risk/permissions/health, MCP servers with live health check,
  core tools, encrypted secrets management.
- Create Skill / Create Plugin: editable JSON manifest, server-side validation with permission review,
  save locally. Remote publishing is intentionally not presented as available.
- Agent capabilities dialog (from Agents): resolved skills/plugins/tools/permissions, blocked reasons,
  digest, policy editing, snapshot recording and a tool test runner.

All actions call real endpoints. There are no decorative controls.

## 9. Tests

- Backend: `api-server/src/extensions/extensions.test.ts` (21 tests) covers validation, Git
  marketplaces, sync add/change/remove/immutability, install/dependency resolution, conflicts, scope
  isolation, RBAC, revocation, secrets at rest, MCP execution, HTTP plugin execution, missions with
  capability snapshots, disable/deny behaviour, update/rollback, and the full REST flow.
  Run with `cd api-server && npm test`.
- Client: `client/tests/extensions.test.mjs` (6 tests) covers filtering, plan blockers, input parsing,
  templates and bilingual key parity. Run with `cd client && npm test`.
- End-to-end manual verification: a Git marketplace can be registered and synchronized, the echo plugin
  installed to an agent, enabled, discovered (`wora.echo-mcp.echo`), executed, used in a mission,
  disabled (403 on the next call) and uninstalled.

## 10. Known limitations

- Remote publishing to a marketplace is not implemented; custom packages are stored locally.
- Marketplace Git operations require the `git` binary on the host.
- Native in-process plugins are refused by design; use MCP or HTTP adapters.
- MCP stdio plugins are spawned as child processes without an OS-level sandbox (no seccomp/container).
  They receive a filtered environment; process-control variables and runtime loader flags are rejected.
  Stdio is disabled by default and only the bundled official catalog may run. Run WORA in a container
  if stronger isolation is required.
- HTTP plugin credentials use a single bearer secret per plugin, not per-tool OAuth flows.
- Lifecycle hooks are not supported.
- Auto-load is metadata-only; there is no background auto-update.
