import type { AgentParticipant, SharedWorkspaceEntry, SharedWorkspaceState } from '../types.js';
import type { ActivityFeedItem } from '../store/useWoraStore.js';

export const DIRECTOR_ROOM_ID = 'zone-boardroom';
export const LOCAL_TASK_PREFIX = 'local-ws-';
export type TaskScope = 'server' | 'preview' | 'local';
export type ServerMode = Exclude<TaskScope, 'local'>;
export const TASK_BRIEF_LIMIT = 1_200;

export const TASK_STATUS: Record<SharedWorkspaceEntry['status'], string> = {
  open: 'بانتظار التنفيذ', claimed: 'تم الاستلام', in_progress: 'قيد التنفيذ', review_pending: 'قيد المراجعة',
  done: 'مكتملة', approved: 'معتمدة', rejected: 'مرفوضة', expired: 'منتهية',
};

export const isInProgress = (entry: SharedWorkspaceEntry) => ['claimed', 'in_progress', 'review_pending'].includes(entry.status);
export const isFinished = (entry: SharedWorkspaceEntry) => entry.status === 'approved' || entry.status === 'done';
export const isOpenTask = (entry: SharedWorkspaceEntry) => entry.status === 'open' || isInProgress(entry);
export const canTakeTask = (agent: AgentParticipant) => agent.status !== 'OFFLINE' && agent.status !== 'AWAY' && agent.lifecycleState !== 'ERROR';
export const isBusyAgent = (agent: AgentParticipant) => canTakeTask(agent) && (agent.status === 'BUSY' || agent.lifecycleState !== 'IDLE');
export const isLocalTask = (entry: SharedWorkspaceEntry) => entry.id.startsWith(LOCAL_TASK_PREFIX);
export const taskSourceLabel = (entry: SharedWorkspaceEntry) => isLocalTask(entry) ? 'محلية' : entry.payload['preview'] === true ? 'معاينة' : null;
export const isRecorded = (entry: SharedWorkspaceEntry, now: number) => !entry.id.startsWith('init-') && entry.payload['sample'] !== true
  && entry.status !== 'expired' && (!entry.expiresAt || Date.parse(entry.expiresAt) > now);

export function taskStage(entry: SharedWorkspaceEntry) {
  if (entry.status === 'open' && entry.payload['directorExecution'] === 'failed') return 'تعذّر رد الوكيل';
  if (entry.status === 'open' && entry.payload['directorExecution'] === 'pending') return 'بانتظار رد الوكيل';
  return TASK_STATUS[entry.status];
}

export function taskExecutionNote(entry: SharedWorkspaceEntry | undefined) {
  if (!entry) return null;
  if (entry.status === 'review_pending' && typeof entry.payload['directorResponse'] === 'string') return 'ردّ الوكيل جاهز للمراجعة.';
  if (entry.status === 'in_progress' && entry.payload['directorExecution'] === 'pending') return 'الوكيل بيحضّر ردّه.';
  if (entry.status === 'open' && entry.payload['directorExecution'] === 'pending') return 'بانتظار بدء ردّ الوكيل.';
  if (entry.status === 'open' && entry.payload['directorExecution'] === 'unavailable') return 'المهمة مسجّلة، لكن تشغيل الوكيل غير متاح هنا دلوقتي.';
  if (entry.status === 'open' && entry.payload['directorExecution'] === 'failed') return 'تعذّر ردّ الوكيل. المهمة لسه مسجّلة في اللوحة.';
  return null;
}

export function officeTasks(workspaces: Record<string, SharedWorkspaceState>, now = Date.now()) {
  return Object.values(workspaces).flatMap((workspace) => workspace.entries)
    .filter((entry) => ['task', 'review', 'handoff'].includes(entry.type) && isRecorded(entry, now))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function taskCountByAgent(tasks: readonly SharedWorkspaceEntry[]) {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (!isOpenTask(task)) continue;
    const agent = task.targetAgentId ?? task.authorAgentId;
    counts.set(agent, (counts.get(agent) ?? 0) + 1);
  }
  return counts;
}

export function briefTitle(brief: string) {
  const clean = brief.trim().replace(/\s+/gu, ' ');
  if (clean.length <= 148) return clean;
  return `${clean.slice(0, 147).replace(/[\uD800-\uDBFF]$/u, '').trimEnd()}…`;
}

const clock = new Intl.DateTimeFormat('ar-EG', { hour: '2-digit', minute: '2-digit' });
export const localTime = (iso: string) => { const time = Date.parse(iso); return Number.isFinite(time) ? clock.format(time) : ''; };

const EXPERTISE: Record<string, { label: string; keywords: string }> = {
  'zone-engineering': { label: 'الهندسة والتطوير', keywords: 'برمجة|برمج|برمجية|مبرمج|الكود|كود|تطبيق|تطوير|طور|باك اند|اصلاح|اصلح|قاعدة البيانات|خادم|coding|code|implement|implementation|bug|fix|اصلاح خطا|api|backend|frontend|database|react|typescript|node|devops' },
  'zone-planning': { label: 'التخطيط وتنظيم العمل', keywords: 'خطة|تخطيط|أولويات|اولويه|جدول|قسّم|تقسيم|سبرنت|خارطة الطريق|تنظيم|نسق|strategy|roadmap|sprint|plan|planning|priorities|milestones' },
  'zone-review': { label: 'مراجعة الجودة والاختبار', keywords: 'جودة|اختبار|اختبارات|اختبر|اختبري|راجع|مراجعة|تدقيق|افحص|اختبار التسجيل|تحقق|checklist|review|testing|test|tests|audit|qa|regression' },
  'zone-analytics': { label: 'البيانات والتحليل المالي', keywords: 'حلل|تحليل|تحليلات|بيانات|احصائيات|مؤشرات|ايراد|ايرادات|تكاليف|تكلفة|ميزانية|ارقام|analytics|metrics|analyze|analysis|dashboard|financial|finance|forecast|budget' },
  'zone-design': { label: 'التصميم وتجربة المستخدم', keywords: 'تصميم|صمم|شعار|هوية|واجهات|تجربة المستخدم|فيجما|ألوان|design|ui|ux|logo|figma|wireframe|branding' },
  'zone-marketing': { label: 'التسويق والمحتوى', keywords: 'تسويق|محتوى|بوست|منشور|حملة|حملات|اعلان|اعلانات|انستجرام|منشورات|سوشيال|كلمات مفتاحية|marketing|content|campaign|ads|seo|instagram|copywriting' },
  'zone-product': { label: 'المنتج والابتكار', keywords: 'منتج|فكرة|ابتكار|متطلبات|نموذج أولي|اكتشاف|product|prototype|prd|discovery|validation' },
  'zone-sales': { label: 'المبيعات ودعم العملاء', keywords: 'مبيعات|بيع|عملاء|دعم|صفقة|صفقات|رسالة متابعة|sales|support|customers|crm|deals' },
};

function words(text: string) {
  return text.toLowerCase().normalize('NFKC').replace(/[أإآٱ]/gu, 'ا').replace(/[ى]/gu, 'ي').replace(/ة/gu, 'ه')
    .replace(/[\u064b-\u065f\u0670ـ]/gu, '').match(/[\p{L}\p{N}]+/gu) ?? [];
}

function variants(token: string) {
  return new Set([token, token.replace(/^(?:و|ف)?(?:ب|ل)?ال(?=.{3})/u, ''), token.replace(/^و(?=.{4})/u, '')]);
}

function mentions(tokens: Set<string>[], phrase: string) {
  const needle = words(phrase).map(variants);
  return needle.length > 0 && tokens.some((_, start) => needle.every((word, offset) => [...word].some((item) => tokens[start + offset]?.has(item))));
}

export function asksForReport(input: string) {
  const text = words(input).join(' ').replace(/ (?:لو سمحت|من فضلك)$/u, '');
  if (/^(?:what happened(?: today)?|what(?: s| is) the status|(?:show me )?(?:the )?(?:workspace (?:report|summary)|open tasks|recent activity))$/u.test(text)) return true;
  return /^(?:(?:اعرض|هات|وريني|اديني|عايز|عاوز|ممكن) )?(?:ملخص(?: (?:الساحه|المقر|اليوم|الشغل|العمل|المهام))?|تقرير (?:الساحه|المقر|النشاط|الشغل|اليوم|المهام)|حاله الفريق|المهام المفتوحه|التاسكات المفتوحه|مين شغال|ايه (?:اللي|الي) (?:حصل|اتعمل)(?: (?:النهارده|اليوم|دلوقتي))?|ماذا حدث)$/u.test(text);
}

export type Candidate = { agent: AgentParticipant; zoneId: string; workload: number; fit: number; reason: string; availability: string; locked: boolean };

/** Exact normalized words and phrases avoid accidental matches inside product or agent names. */
export function rankCandidates(brief: string, agents: AgentParticipant[], tasks: SharedWorkspaceEntry[], locked: (id: string) => boolean): Candidate[] {
  const tokens = words(brief).map(variants);
  const load = taskCountByAgent(tasks);
  return agents.filter((agent) => agent.zoneId && canTakeTask(agent)).map((agent) => {
    const zoneId = agent.zoneId!;
    const domain = EXPERTISE[zoneId];
    const domainMatch = (domain?.keywords.split('|') ?? []).filter((term) => mentions(tokens, term));
    const skills = [...new Set([...agent.profile.skills, ...(agent.profile.specialty?.split(/[,/،·]+/u) ?? []), agent.profile.customRole])]
      .filter((skill) => words(skill).join('').length >= 2 && mentions(tokens, skill.trim()));
    const declared = Math.max(load.get(agent.id) ?? 0, agent.activeTasks ?? 0);
    const busy = isBusyAgent(agent);
    const fit = domainMatch.length * 3 + Math.min(skills.length, 3) * 2;
    const role = domain?.label ?? agent.profile.customRole;
    const match = skills[0]?.trim() || domainMatch[0];
    const availability = busy ? 'يعمل الآن' : declared ? `${declared} من المهام المفتوحة لديه` : 'لا توجد مهام مفتوحة لديه';
    return { agent, zoneId, availability, workload: declared + (busy ? 2 : 0), fit, locked: locked(zoneId),
      reason: fit ? `تخصصه ${role}، وتطابَق مع «${match}». ${availability}.` : `لا يوجد تطابق واضح. هذا الوكيل أقل حملاً بين المتاحين (${role}).` };
  }).sort((a, b) => b.fit - a.fit || Number(a.locked) - Number(b.locked) || a.workload - b.workload || a.agent.id.localeCompare(b.agent.id));
}

export function bestSkillMatch(ranked: readonly Candidate[]) {
  return ranked.find((candidate) => !candidate.locked && candidate.fit > 0) ?? ranked.find((candidate) => candidate.fit > 0);
}

export function officeReport(workspaces: Record<string, SharedWorkspaceState>, events: ActivityFeedItem[], agents: AgentParticipant[], now = Date.now()) {
  const tasks = officeTasks(workspaces, now);
  return {
    capturedAt: new Date(now).toISOString(),
    waiting: tasks.filter((entry) => entry.status === 'open').length,
    working: tasks.filter(isInProgress).length,
    finished: tasks.filter(isFinished).length,
    local: tasks.filter(isLocalTask).length,
    busy: agents.filter(isBusyAgent).length,
    recentTasks: tasks.slice(0, 4),
    recentEvents: events.slice(0, 4),
  };
}

export type OfficeReport = ReturnType<typeof officeReport>;
