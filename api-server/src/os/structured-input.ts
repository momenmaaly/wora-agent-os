/**
 * WORA OS — bounded extraction of structured problem payloads from free text.
 *
 * A mission may embed one or more JSON models alongside prose. Extraction is
 * deliberately strict: only complete top-level objects are returned, strings
 * are parsed safely, and the number of blocks is bounded. The objective text
 * remains the authority; extracted blocks are evidence to be formulated and
 * validated, never an executable action by themselves.
 */
export const STRUCTURED_INPUT_SCHEMA_VERSION = '1.0';

const MAX_BLOCKS = 6;
const MAX_BLOCK_LENGTH = 20_000;

export function extractStructuredJsonBlocks(text: string): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length && blocks.length < MAX_BLOCKS; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const candidate = text.slice(start, index + 1);
        if (candidate.length <= MAX_BLOCK_LENGTH) {
          try {
            const parsed = JSON.parse(candidate) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) blocks.push(parsed as Record<string, unknown>);
          } catch { /* not a complete JSON object; keep scanning */ }
        }
        start = -1;
      }
    }
  }
  return blocks;
}

export function extractStructuredJson(text: string): Record<string, unknown> | null {
  const blocks = extractStructuredJsonBlocks(text);
  return blocks.length === 1 ? blocks[0]! : null;
}
