/** Encrypted-at-rest task tool inputs; legacy plaintext rows remain readable. */
import { fieldAad, openJson, sealJson } from './field-crypto.js';

export function sealTaskToolInput(workspaceId: string, taskId: string, value: unknown): string {
  return sealJson(value, fieldAad('task-tool-input', workspaceId, taskId));
}

export function openTaskToolInput<T>(workspaceId: string, taskId: string, raw: string | null | undefined, fallback: T): T {
  return openJson<T>(raw, fieldAad('task-tool-input', workspaceId, taskId), fallback);
}
