/**
 * WORA extensions — composition root.
 *
 * Applies the schema, seeds the official catalog per workspace, wires plugin
 * tools into the core registry and rebuilds approved tool registrations.
 */
import { ensureExtensionSchema } from './schema.js';
import { registerPluginToolProvider } from '../os/tools.js';
import { executePluginTool, pluginToolDefinitions, refreshAllInstallations } from './runtime.js';
import { seedBuiltinCatalog } from './builtin.js';
import { logger } from '../lib/logger.js';

let initialized = false;
const seeded = new Set<string>();

export function initExtensions(): void {
  if (initialized) return;
  ensureExtensionSchema();
  registerPluginToolProvider(pluginToolDefinitions, executePluginTool);
  initialized = true;
}

/** Idempotent per process: seed the official catalog and reconcile resources. */
export function ensureWorkspaceExtensions(workspaceId: string): void {
  initExtensions();
  if (seeded.has(workspaceId)) return;
  try {
    seedBuiltinCatalog(workspaceId);
    refreshAllInstallations(workspaceId);
    seeded.add(workspaceId);
  } catch (error) {
    logger.warn({ err: error, workspaceId }, 'extension catalog seeding failed (OS remains available)');
  }
}

/** Tests only. */
export function resetExtensionsForTests(): void {
  initialized = false;
  seeded.clear();
}

export { createExtensionsRouter } from './router.js';
export { resolveCapabilities, resolveAndSnapshot, authorizeTool, executeForAgent } from './capabilities.js';
