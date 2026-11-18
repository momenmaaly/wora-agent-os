import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, ExternalLink, Github, Plus, Puzzle, ShieldCheck } from 'lucide-react';
import { getAgentSkills, importAgentSkill, setAgentSkillActive, skillErrorMessage } from '../skills/api.js';
import { useWoraStore } from '../store/useWoraStore.js';
import type { AgentParticipant, AgentSkillCatalog, ImportedSkill } from '../types.js';
import { AgentAvatar } from './OfficePeople.js';
import { Dialog } from './ui.js';

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function Inputs({ schema }: { schema: ImportedSkill['inputSchema'] }) {
  if (!schema) return <p className="field-note">المستودع لا يصرّح بمخطط مدخلات. لا يمكن تحديد المدخلات المطلوبة.</p>;
  const properties = record(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : [];
  const fields = [...new Set([...required, ...Object.keys(properties)])];
  return <div className="skill-inputs">
    <h4>المدخلات <bdi dir="ltr">JSON Schema</bdi></h4>
    {fields.length > 0 ? <ul>{fields.map((field) => {
      const value = properties[field];
      const type = record(value) ? (typeof value.type === 'string' ? value.type : Array.isArray(value.type) ? value.type.filter((item) => typeof item === 'string').join(' | ') : '') : '';
      return <li key={field}><bdi>{field}</bdi><bdi className="subtle">{type || '—'}</bdi><span className={required.includes(field) ? 'is-required' : 'subtle'}>{required.includes(field) ? 'مطلوب' : 'اختياري'}</span></li>;
    })}</ul> : <p className="field-note">لا توجد حقول مسمّاة في هذا المخطط.</p>}
    <details><summary>عرض المخطط الكامل</summary><pre className="hq-scroll" dir="ltr" tabIndex={0} aria-label="مخطط JSON">{JSON.stringify(schema, null, 2)}</pre></details>
  </div>;
}

function SkillTag({ skill }: { skill: ImportedSkill }) {
  return <span className={`skill-tag${skill.active ? ' is-active' : ''}`}><i aria-hidden="true" />{skill.active ? 'مفعّلة' : 'غير مفعّلة'}</span>;
}

type Step = { kind: 'catalog' } | { kind: 'import' } | { kind: 'review'; skillId: string };

function SkillsPanel({ agent, roomId, onClose }: { agent: AgentParticipant; roomId: string; onClose: () => void }) {
  const connected = useWoraStore((s) => s.connected);
  const mode = useWoraStore((s) => s.serverMode);
  const revision = agent.skillSnapshot?.revision ?? 0;
  const ready = connected ? mode : null;
  const [step, setStep] = useState<Step>({ kind: 'catalog' });
  const [url, setUrl] = useState('');
  const [catalog, setCatalog] = useState<AgentSkillCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [writing, setWriting] = useState(false);
  const inFlight = useRef<AbortController | null>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const urlField = useRef<HTMLInputElement>(null);
  const acceptedRevision = useRef(-1);

  function accept(next: AgentSkillCatalog) {
    if (next.revision < acceptedRevision.current) return;
    acceptedRevision.current = next.revision;
    setCatalog(next);
    useWoraStore.getState().updateAgentSkills({ roomId, agentId: agent.id, revision: next.revision, activeNames: next.skills.filter((item) => item.active).map((item) => item.name) });
  }

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setLoading(true); setLoadError('');
    void getAgentSkills(agent.id, ready, controller.signal).then((value) => {
      if (!controller.signal.aborted) accept(value);
    }, (err: unknown) => {
      if (!controller.signal.aborted) setLoadError(skillErrorMessage(err));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ready, revision, reload, agent.id, roomId]);
  useEffect(() => () => { inFlight.current?.abort(); }, []);
  useLayoutEffect(() => {
    if (step.kind === 'review') reviewHeading.current?.focus();
    else if (step.kind === 'import' && ready) urlField.current?.focus();
  }, [step, ready]);

  function goTo(value: Step) { setError(''); setNotice(''); setStep(value); }

  async function mutate(action: (signal: AbortSignal) => Promise<void>) {
    if (!ready || inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setWriting(true); setError(''); setNotice('');
    try { await action(controller.signal); }
    catch (err) { if (!controller.signal.aborted) setError(skillErrorMessage(err)); }
    finally { inFlight.current = null; if (!controller.signal.aborted) setWriting(false); }
  }

  function importSkill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url.trim() || !ready) return;
    void mutate(async (signal) => {
      const result = await importAgentSkill(agent.id, ready, url.trim(), signal);
      if (signal.aborted) return;
      accept(result.catalog);
      setUrl('');
      setStep({ kind: 'review', skillId: result.skillId });
    });
  }

  function toggle(skill: ImportedSkill) {
    if (!ready) return;
    void mutate(async (signal) => {
      const next = await setAgentSkillActive(agent.id, ready, skill.id, !skill.active, signal);
      if (signal.aborted) return;
      accept(next);
      setNotice(skill.active ? 'أُلغي تفعيل المهارة لهذا الوكيل.' : 'سُجّلت المهارة كمفعّلة لهذا الوكيل.');
    });
  }

  const focused = step.kind === 'review' ? catalog?.skills.find((skill) => skill.id === step.skillId) : undefined;
  const title = step.kind === 'import' ? 'استيراد مهارة من GitHub' : step.kind === 'review' ? 'مراجعة المهارة' : 'مهارات الوكيل';
  const formDisabled = !ready || writing;
  return <Dialog icon={Github} className="skills-dialog" title={title} onClose={onClose}
    footer={step.kind === 'import' ? <><button className="button ghost" type="button" onClick={() => goTo({ kind: 'catalog' })} disabled={writing}>قائمة المهارات</button><button type="submit" form="skill-import-form" className="button primary" disabled={formDisabled || !url.trim()}><Github size={16} aria-hidden="true" />{writing ? 'جارٍ قراءة التعريف…' : 'استيراد للمراجعة'}</button></>
      : step.kind === 'review' ? <><button className="button ghost" type="button" onClick={() => goTo({ kind: 'catalog' })} disabled={writing}><ArrowRight size={15} aria-hidden="true" />قائمة المهارات</button>{focused && <button className={`button${focused.active ? '' : ' primary'}`} onClick={() => toggle(focused)} disabled={formDisabled}>{writing ? 'جارٍ الحفظ…' : focused.active ? 'إلغاء التفعيل' : 'تفعيل المهارة'}</button>}</>
        : <button className="button primary" type="button" onClick={() => goTo({ kind: 'import' })} disabled={!ready}><Plus size={16} aria-hidden="true" />استيراد من GitHub</button>}>
    <div className="skill-agent-context"><AgentAvatar agent={agent} /><div><strong><bdi>{agent.displayName}</bdi></strong><small dir="auto">{agent.profile.customRole}</small></div></div>
    {!ready && <p className="notice">يلزم الاتصال بخادم مساحة العمل لاستيراد المهارات أو تفعيلها.</p>}
    {ready === 'preview' && <p className="field-note">سجل المعاينة مؤقت: يبقى عند إعادة تحميل الصفحة، ويُمسح عند إعادة تشغيل الخادم.</p>}
    {step.kind === 'import' && <form id="skill-import-form" className="field-stack" onSubmit={importSkill}>
      <label className="label">رابط المستودع العام<input ref={urlField} data-initial-focus={ready ? '' : undefined} dir="ltr" className="field skill-url" type="url" placeholder="https://github.com/owner/repo" maxLength={240} value={url} required autoComplete="off" spellCheck={false} onChange={(event) => setUrl(event.target.value)} disabled={formDisabled} /></label>
      <div className="skill-import-hint"><p className="field-note">يقرأ Wora ملف <bdi dir="ltr">skill.json</bdi> أو <bdi dir="ltr">README.md</bdi>. تُحفظ المهارة غير مفعّلة حتى تراجعها.</p>
        {ready === 'preview' && <button className="text-link" type="button" onClick={() => { setUrl('https://github.com/octocat/Spoon-Knife'); urlField.current?.focus(); }} disabled={writing}>استخدم رابط مثال</button>}
      </div>
    </form>}
    {step.kind === 'catalog' && <div className="skill-catalog" aria-busy={Boolean(ready && loading)}>
      {loadError && ready && <div className="skill-load-error"><p role="alert">{loadError}</p><button className="button small" type="button" onClick={() => setReload((number) => number + 1)}>إعادة التحميل</button></div>}
      {ready && loading && !catalog && <p role="status" className="field-note">جارٍ تحميل السجلّ…</p>}
      {catalog && (catalog.skills.length ? (['active', 'inactive'] as const).map((group) => {
        const items = catalog.skills.filter((skill) => skill.active === (group === 'active'));
        return <section className="skill-list-group" key={group} aria-label={group === 'active' ? 'المهارات المفعّلة' : 'المهارات غير المفعّلة'}>
          <h3>{group === 'active' ? 'المهارات المفعّلة' : 'غير مفعّلة'} <bdi>{items.length}</bdi></h3>
          {items.length > 0 ? <ul>{items.map((skill) => <li key={skill.id}>
            <button className="skill-list-row" type="button" onClick={() => goTo({ kind: 'review', skillId: skill.id })}>
              <Puzzle size={17} aria-hidden="true" /><span><strong><bdi>{skill.name}</bdi></strong><small dir="ltr">{skill.source.repository}</small></span><SkillTag skill={skill} />
            </button>
          </li>)}</ul> : <p className="field-note">لا توجد مهارات في هذه المجموعة.</p>}
        </section>;
      }) : <p className="field-note">لم تُستورد مهارات لهذا الوكيل بعد.</p>)}
    </div>}
    {focused && <article className="skill-review">
      <div className="skill-review-title"><h3 ref={reviewHeading} tabIndex={-1} dir="auto">{focused.name}</h3><SkillTag skill={focused} /></div>
      <p dir="auto">{focused.description}</p>
      <a href={focused.source.url} className="skill-source" dir="ltr" target="_blank" rel="noopener noreferrer" aria-label={`GitHub: ${focused.source.repository}`}>
        <Github size={15} aria-hidden="true" /><span>{focused.source.repository}<small>{focused.source.path} · {focused.source.sha.slice(0, 7)}</small></span><ExternalLink size={14} aria-hidden="true" />
      </a>
      <Inputs schema={focused.inputSchema} />
    </article>}
    <div className="skill-safety"><ShieldCheck size={16} aria-hidden="true" /><p>التفعيل يسجّل تعريف المهارة فقط. لا يتم تثبيت كود المستودع أو تشغيله، ولا تُرسل بياناته إلى النموذج.</p></div>
    {writing && <p className="field-note" role="status">{step.kind === 'import' ? 'جارٍ جلب بيانات المستودع…' : 'جارٍ تحديث السجل…'}</p>}
    {notice && <p className="skill-success" role="status">{notice}</p>}
    {error && <p className="director-error" role="alert">{error}</p>}
  </Dialog>;
}

export function AgentSkillsDialog() {
  const agent = useWoraStore((s) => s.ui.skillsAgentId ? s.agents[s.ui.skillsAgentId] : undefined);
  const roomId = useWoraStore((s) => s.roomId);
  const close = useWoraStore((s) => s.openAgentSkills);
  return agent ? <SkillsPanel key={`${roomId}/${agent.id}`} roomId={roomId} agent={agent} onClose={() => close(null)} /> : null;
}
