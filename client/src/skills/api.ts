import { readPreviewSession, readSessionToken } from '../lib/session.js';
import type { AgentSkillCatalog, ImportedSkill } from '../types.js';
import type { ServerMode } from '../office/work.js';

export class SkillsRequestError extends Error {
  constructor(readonly code: string) { super(code); }
}

const messages: Record<string, string> = {
  INVALID_REPOSITORY: 'أدخل رابط مستودع عام بصيغة https://github.com/owner/repo، من دون مسار ملف أو فرع.',
  REPO_NOT_PUBLIC: 'المستودع غير موجود أو ليس عامًا. تحقّق من الرابط.',
  NO_SKILL_METADATA: 'لم نجد skill.json أو README.md مناسبًا في المستودع.',
  INVALID_SKILL_METADATA: 'تعذّرت قراءة تعريف المهارة. راجع صيغة skill.json أو محتوى README.md.',
  METADATA_TOO_LARGE: 'ملف التعريف يتجاوز الحجم المسموح به.',
  GITHUB_RATE_LIMIT: 'وصل الاتصال إلى حدّ طلبات GitHub. جرّب لاحقًا.',
  GITHUB_UNAVAILABLE: 'تعذّر الاتصال بـ GitHub. جرّب مرة أخرى.',
  SKILLS_UNAVAILABLE: 'استيراد المهارات غير مهيّأ في هذا الخادم.',
  SIGN_IN_REQUIRED: 'تحتاج إلى جلسة دخول سارية لإدارة مهارات مساحة العمل.',
  AGENT_NOT_FOUND: 'هذا الوكيل لم يعد متاحًا على الخادم.',
  SKILL_NOT_FOUND: 'لم نعد نجد هذه المهارة. حدّث القائمة.',
  SKILL_LIMIT: 'وصل الوكيل إلى حدّ ١٢ مهارة مستوردة.',
  SKILLS_BUSY: 'سجل المهارات مشغول الآن. جرّب مرة أخرى.',
  RATE_LIMITED: 'تم بلوغ حدّ الطلبات. حاول لاحقًا.',
  INVALID_REQUEST: 'تعذّر قبول الطلب. تحقّق من القيم وحاول مرة أخرى.',
};

export function skillErrorMessage(error: unknown) {
  return error instanceof SkillsRequestError && Object.hasOwn(messages, error.code) ? messages[error.code]!
    : 'تعذّر تأكيد الطلب. راجع القائمة قبل إعادة المحاولة.';
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function validSkill(skill: unknown): skill is ImportedSkill {
  if (!record(skill) || !record(skill.source)) return false;
  const { source } = skill;
  return typeof skill.id === 'string' && /^[\da-f-]{36}$/u.test(skill.id) && typeof skill.name === 'string' && typeof skill.description === 'string'
    && typeof skill.active === 'boolean' && typeof skill.importedAt === 'string' && (skill.inputSchema === null || record(skill.inputSchema))
    && typeof source.repository === 'string' && /^[a-z0-9-]+\/[a-z0-9_.-]+$/u.test(source.repository)
    && source.url === `https://github.com/${source.repository}` && typeof source.sha === 'string' && typeof source.path === 'string'
    && (source.kind === 'skill.json' || source.kind === 'readme');
}

async function request(agentId: string, mode: ServerMode, suffix: string, signal: AbortSignal, options: RequestInit = {}) {
  const configured = import.meta.env.VITE_API_URL?.trim();
  const token = mode === 'preview' ? readPreviewSession() : readSessionToken();
  if (!token) throw new SkillsRequestError('SIGN_IN_REQUIRED');
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(new URL(`/api/agents/${encodeURIComponent(agentId)}/skills${suffix}`, configured || window.location.origin), {
    ...options, headers, signal: AbortSignal.any([signal, AbortSignal.timeout(16_000)]), cache: 'no-store', redirect: 'error',
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new SkillsRequestError(record(body) && typeof body.code === 'string' ? body.code : 'REQUEST_FAILED');
  if (!record(body) || typeof body.revision !== 'number' || !Number.isSafeInteger(body.revision) || body.revision < 0
    || !Array.isArray(body.skills) || body.skills.length > 12 || !body.skills.every(validSkill)) throw new SkillsRequestError('INVALID_RESPONSE');
  return { revision: body.revision, skills: body.skills, skillId: typeof body.skillId === 'string' ? body.skillId : null };
}

export function getAgentSkills(agentId: string, mode: ServerMode, signal: AbortSignal): Promise<AgentSkillCatalog> {
  return request(agentId, mode, '', signal);
}

export async function importAgentSkill(agentId: string, mode: ServerMode, url: string, signal: AbortSignal) {
  const response = await request(agentId, mode, '/import-github', signal, { method: 'POST', body: JSON.stringify({ url }) });
  if (!response.skillId || !response.skills.some((skill) => skill.id === response.skillId)) throw new SkillsRequestError('INVALID_RESPONSE');
  return { catalog: response, skillId: response.skillId };
}

export function setAgentSkillActive(agentId: string, mode: ServerMode, skillId: string, active: boolean, signal: AbortSignal): Promise<AgentSkillCatalog> {
  return request(agentId, mode, `/${encodeURIComponent(skillId)}`, signal, { method: 'PATCH', body: JSON.stringify({ active }) });
}
