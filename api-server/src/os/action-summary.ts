/**
 * Human-reviewable action summaries for approvals.
 *
 * The summary is generated from the actual tool id and payload, never from a
 * free-form agent sentence. A high-risk action whose target, effect or resource
 * impact cannot be established is refused before an approval row is written.
 */
import { redactSecrets } from './secrets.js';

export interface ActionReviewInput {
  toolId: string | null;
  toolInput: unknown;
  risk: string;
  toolDescription?: string | null;
  toolPermissions?: string[] | null;
}

export interface ActionReview {
  summary: string;
  target: string;
  consequences: string;
  resourceImpact: string;
  summaryVersion: 'wora-review-v1';
  safe: boolean;
  reason?: string;
}

const text = (value: unknown, cap = 300): string =>
  typeof value === 'string' ? redactSecrets(value).value.slice(0, cap) : '';

function record(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

function pathTarget(input: Record<string, unknown>): string {
  return text(input['path'] ?? input['cwd'] ?? input['dir'] ?? input['repoPath'] ?? input['target'], 300) || '(workspace)';
}

function urlTarget(input: Record<string, unknown>): string {
  return text(input['url'], 500) || '(missing URL)';
}

function commandTarget(input: Record<string, unknown>): string {
  const command = text(input['command'], 80);
  const args = Array.isArray(input['args']) ? input['args'].filter((arg): arg is string => typeof arg === 'string').map((arg) => text(arg, 200)) : [];
  return [command, ...args].filter(Boolean).join(' ') || '(missing command)';
}

function safeCommand(input: Record<string, unknown>): boolean {
  const command = input['command'];
  const args = input['args'];
  return command === 'node' && Array.isArray(args) && args[0] === '--test'
    && args.slice(1).every((arg) => typeof arg === 'string' && !arg.startsWith('-') && !arg.includes('..'));
}

/**
 * `getTool` is passed by the orchestrator so this module stays independent of
 * the tool registry and cannot create a governance/registry import cycle.
 */
export function buildActionReview(input: ActionReviewInput): ActionReview {
  const tool = input.toolId ?? '';
  const data = record(input.toolInput);
  const description = text(input.toolDescription, 400);
  const permissions = (input.toolPermissions ?? []).map((permission) => text(permission, 100)).filter(Boolean);
  const risk = input.risk === 'high' || input.risk === 'medium' || input.risk === 'low' ? input.risk : 'high';
  const base = { summaryVersion: 'wora-review-v1' as const };

  if (tool === 'host.exec') {
    const target = commandTarget(data);
    const safe = safeCommand(data);
    return {
      ...base, safe,
      target,
      consequences: 'Runs the repository test suite through Node with no shell. Test code executes with the API process user and can read/write files and reach the network available to that process.',
      resourceImpact: 'CPU and wall-clock time are bounded by the tool timeout (45s); stdout/stderr are capped at 1 MiB.',
      summary: safe
        ? `Run Node tests: ${target}. This executes repository test code in the WORA workspace.`
        : 'Refused: host.exec is not a bounded `node --test` invocation.',
      ...(safe ? {} : { reason: 'command is not an allowlisted node --test invocation' }),
    };
  }

  if (tool === 'scaffold.webapp') {
    const name = text(data['name'], 100) || '(unnamed app)';
    return {
      ...base, safe: Boolean(name !== '(unnamed app)'),
      target: `apps/${name}`,
      consequences: 'Creates a small application inside the workspace and may run its generated Node test suite. Existing files under that app path can be replaced.',
      resourceImpact: 'Workspace file writes plus a bounded test run; no external deployment.',
      summary: `Generate and test the web app "${name}" inside the workspace.`,
      ...(name === '(unnamed app)' ? { reason: 'missing app name' } : {}),
    };
  }

  if (tool === 'security.scan') {
    return {
      ...base, safe: true,
      target: pathTarget(data),
      consequences: 'Reads files in the target path and reports security findings. It does not modify files.',
      resourceImpact: 'Bounded filesystem traversal and CPU time; no network calls.',
      summary: `Scan ${pathTarget(data)} for security findings.`,
    };
  }

  if (tool === 'fs.workspace_read' || tool === 'fs.workspace_list') {
    return {
      ...base, safe: true,
      target: pathTarget(data),
      consequences: 'Reads workspace content. It does not modify files or contact external services.',
      resourceImpact: 'Read-only, size-capped workspace access.',
      summary: `${tool === 'fs.workspace_list' ? 'List' : 'Read'} ${pathTarget(data)} in the workspace.`,
    };
  }

  if (tool === 'fetch.read') {
    const target = urlTarget(data);
    const parsed = (() => { try { return new URL(target); } catch { return null; } })();
    const safe = Boolean(parsed && (parsed.protocol === 'https:' || parsed.protocol === 'http:'));
    return {
      ...base, safe,
      target,
      consequences: 'Performs one outbound HTTP GET and returns bounded response text. The remote service sees the request.',
      resourceImpact: 'Bounded response size and request timeout; no redirects.',
      summary: `Fetch ${target} over HTTP(S).`,
      ...(safe ? {} : { reason: 'invalid or non-HTTP URL' }),
    };
  }

  if (tool === 'code.repair') {
    const repo = text(data['repoPath'], 300) || '(missing repository)';
    return {
      ...base, safe: repo !== '(missing repository)',
      target: repo,
      consequences: 'Copies the repository into a temporary workspace, applies the supplied patch and runs the declared Node tests. The source repository is never changed by this tool.',
      resourceImpact: 'Temporary disk copy plus bounded test execution; no external deployment.',
      summary: `Repair ${repo} with a bounded patch and test run.`,
      ...(repo === '(missing repository)' ? { reason: 'missing repository path' } : {}),
    };
  }

  if (tool.startsWith('or.')) {
    return {
      ...base, safe: true,
      target: text(data['name'] ?? data['objective'], 200) || 'operations-research input',
      consequences: 'Solves a deterministic operations-research model in-process. It does not modify files or contact external services.',
      resourceImpact: 'CPU and memory bounded by the solver timeout.',
      summary: `Run the ${tool} solver on the supplied model.`,
    };
  }

  if (tool === 'text.summarize' || tool === 'problem.understand' || tool === 'action.classify') {
    return {
      ...base, safe: true,
      target: 'provided text',
      consequences: 'Processes the supplied text in-process. It does not modify files or contact external services.',
      resourceImpact: 'Bounded text processing.',
      summary: `Run ${tool} on the supplied text.`,
    };
  }

  if (tool.startsWith('browser.')) {
    const target = text(data['text'] ?? data['selector'] ?? data['url'] ?? data['sessionId'], 400);
    const safe = Boolean(target);
    return {
      ...base, safe,
      target: target || '(missing browser target)',
      consequences: 'Controls a real isolated Chromium session. A financial click or payment-field entry can commit a purchase or expose payment data only after this approval is consumed.',
      resourceImpact: 'Bounded by the browser tool timeout and the session container limits.',
      summary: `Run ${tool} against ${target || '(missing target)'}.`,
      ...(safe ? {} : { reason: 'missing browser target' }),
    };
  }

  // Plugin tools carry their manifest description and permission list. A target
  // is required because an approver must know what the tool will act on.
  if (description) {
    const target = text(data['path'] ?? data['url'] ?? data['target'] ?? data['repository'] ?? data['name'], 400);
    const sensitive = permissions.filter((permission) => /(?:write|delete|deploy|execute|admin|secret|credential|browser|repository\.write)/iu.test(permission));
    if (!target) {
      return { ...base, safe: false, target: '(unknown)', consequences: description, resourceImpact: 'Unknown', summary: 'Refused: plugin tool has no reviewable target.', reason: 'missing target in tool input' };
    }
    return {
      ...base, safe: true,
      target,
      consequences: `${description}${sensitive.length ? ` Sensitive permissions: ${sensitive.join(', ')}.` : ''}`,
      resourceImpact: 'Bounded by the plugin tool timeout and declared resource limits.',
      summary: `${description} Target: ${target}.`,
    };
  }

  return {
    ...base, safe: false,
    target: '(unknown)',
    consequences: 'No reviewable description or target is available.',
    resourceImpact: 'Unknown',
    summary: 'Refused: this action has no complete, reviewable summary.',
    reason: 'unknown tool or missing description/target',
  };
}

export function assertSafeReview(review: ActionReview): void {
  if (!review.safe) throw new Error(`Approval refused: ${review.reason ?? 'action summary is incomplete'}`);
  if (!review.target || review.target === '(unknown)' || !review.consequences || !review.resourceImpact) {
    throw new Error('Approval refused: action summary is incomplete');
  }
}
