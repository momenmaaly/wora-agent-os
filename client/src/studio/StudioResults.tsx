import { useState, type Ref } from 'react';
import { ArrowLeft, Check, ClipboardCheck, Copy, Download, FolderPlus, Package, PencilLine, Plus, RotateCw } from 'lucide-react';
import { PLANS } from '../billing/plans.js';
import { IconTile, Notice } from '../components/ui.js';
import { useBillingStore } from '../store/useBillingStore.js';
import { studioSaveState, useProjectStore } from '../store/useProjectStore.js';
import { formatUSD, margin, packAsText, POSITIONING, SOURCE_LABEL, type StudioDraft } from './drafts.js';
import { StudioCopyDialog, StudioDraftDialog } from './StudioDialogs.js';
import { useStudioStore, type StudioSession } from './useStudioStore.js';

export function StudioResults({ session, generating, titleRef, onProjects, onReuseBrief }: {
  session: StudioSession;
  generating: boolean;
  titleRef: Ref<HTMLHeadingElement>;
  onProjects: () => void;
  onReuseBrief: () => void;
}) {
  const plan = useBillingStore((state) => state.plan);
  const projects = useProjectStore((state) => state.projects);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const products = useProjectStore((state) => state.products);
  const [destination, setDestination] = useState(activeProjectId);
  const [editing, setEditing] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');
  const [showCopyText, setShowCopyText] = useState(false);
  const { brief, pack, source } = session;
  const project = projects.find(({ id }) => id === destination) ?? projects[0];
  const linked = products.filter((item) => item.projectId === project?.id && item.studioRef?.sessionId === session.id);
  const states = pack.drafts.map((draft, index) => studioSaveState(draft, linked.find((item) => item.studioRef?.index === index)));
  const needNew = states.filter((state) => state === 'new').length;
  const hasUpdates = states.includes('changed');
  const slots = Math.max(0, PLANS[plan].limits.products - products.length);
  const editingDraft = editing === null ? undefined : pack.drafts[editing];

  async function copy() {
    try {
      await navigator.clipboard.writeText(packAsText(brief, pack, source));
      setFeedback('تم نسخ الحزمة إلى الحافظة.');
    } catch {
      setShowCopyText(true);
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([packAsText(brief, pack, source)], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `wora-studio-${session.createdAt.slice(0, 10)}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    setFeedback('تم تجهيز الحزمة للتنزيل.');
  }

  function saveDrafts(indices: number[]) {
    if (!project) return;
    const items = new Map<number, StudioDraft>();
    for (const index of indices) {
      const draft = pack.drafts[index];
      if (draft) items.set(index, draft);
    }
    const result = useProjectStore.getState().saveStudioDrafts(project.id, session.id, items, PLANS[useBillingStore.getState().plan].limits.products);
    if (!result.ok) {
      setFeedback(result.reason === 'limit' ? 'لا تتّسع خطتك لكل المسودات المحدّدة.' : 'المشروع المحدّد غير موجود.');
      return;
    }
    const count = result.added + result.updated;
    setFeedback(count === 1 ? 'تم حفظ المسودة في المشروع.' : count > 1 ? 'تم حفظ المسودات في المشروع.' : 'المسودات محفوظة بالفعل في المشروع.');
  }

  return <section className="panel panel-pad studio-result" aria-labelledby="studio-pack-title">
    <div className="studio-result-header">
      <div className="studio-result-title">
        <div className="studio-kicker"><bdi className="studio-step mono" dir="ltr">02</bdi> حزمة المنتج <span className={`badge tint ${source === 'live' ? 'tone-mint' : 'tone-violet'}`}><span className="status-dot" />{SOURCE_LABEL[source]}</span></div>
        <h2 id="studio-pack-title" ref={titleRef} tabIndex={-1} dir="auto">{pack.title}</h2>
        <p dir="auto">{pack.summary}</p>
      </div>
      <div className="studio-actions">
        <button className="button ghost" type="button" onClick={() => void copy()}><Copy size={15} aria-hidden="true" />نسخ الحزمة</button>
        <button className="button" type="button" onClick={download}><Download size={15} aria-hidden="true" />تنزيل <bdi dir="ltr">TXT</bdi></button>
      </div>
    </div>
    <details className="studio-brief-details">
      <summary>الموجز الأصلي</summary>
      <p dir="auto">{brief.idea}</p>
      <p className="field-note">{brief.audience && <>الجمهور: <bdi>{brief.audience}</bdi> · </>}مستوى التسعير: {POSITIONING[brief.positioning]}</p>
      <button type="button" className="text-link" disabled={generating} onClick={onReuseBrief}><RotateCw size={14} aria-hidden="true" />استخدم هذا الموجز مرّة أخرى</button>
    </details>
    <div className="studio-project-bar">
      <label className="label"><span><FolderPlus size={16} aria-hidden="true" />احفظ في مشروع</span>
        <select className="field" value={project?.id ?? ''} disabled={!project} onChange={(event) => { setDestination(event.target.value); setFeedback(''); }}>
          {!project && <option value="">لا توجد مشاريع</option>}
          {projects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
      </label>
      {project && <div className="studio-project-meta">
        <span className="field-note">{pack.drafts.length - needNew} من {pack.drafts.length} في المشروع{hasUpdates ? ' · توجد تعديلات جديدة' : ''}</span>
        <button type="button" className="text-link" onClick={() => { useProjectStore.getState().setActiveProject(project.id); onProjects(); }}>انتقل إلى المشاريع <ArrowLeft size={14} aria-hidden="true" /></button>
      </div>}
      <button className="button primary" type="button" disabled={!project || needNew > slots || (needNew === 0 && !hasUpdates)} onClick={() => saveDrafts(pack.drafts.map((_draft, index) => index))}>
        <FolderPlus size={16} aria-hidden="true" />{needNew || hasUpdates ? 'احفظ الحزمة' : 'تم حفظ الحزمة'}
      </button>
      {!project && <button className="text-link" type="button" onClick={onProjects}>اذهب إلى المشاريع <ArrowLeft size={14} aria-hidden="true" /></button>}
    </div>
    {project && needNew > slots && <Notice>المساحة المتبقية لمنتجات خطتك: {slots}. يمكنك تحديث نسخ المشروع المحفوظة أو حفظ مسودات فردية إذا كانت هناك مساحة.</Notice>}
    <div className="studio-products-heading"><h3>مسودات المنتجات</h3><span className="field-note">التقديرات بالدولار. الهامش لا يشمل الشحن أو الرسوم.</span></div>
    <div className="catalog-grid studio-products">
      {pack.drafts.map((draft, index) => {
        const saveState = states[index];
        const percent = margin(draft);
        return <article className="catalog-card studio-product" key={index}>
          <div className="studio-draft-meta">
            <IconTile icon={Package} tone={index === 1 ? 'mint' : index === 2 ? 'cyan' : 'violet'} />
            <bdi className="mono">{String(index + 1).padStart(2, '0')} / {String(pack.drafts.length).padStart(2, '0')}</bdi>
          </div>
          <div className="studio-draft-description">
            <span className="studio-category" dir="auto">{draft.category}</span>
            <h4 dir="auto">{draft.name}</h4>
            <p dir="auto">{draft.description}</p>
          </div>
          <dl className="studio-financials">
            <div><dt>السعر</dt><dd><bdi dir="ltr">{formatUSD(draft.price)}</bdi></dd></div>
            <div><dt>التكلفة</dt><dd><bdi dir="ltr">{formatUSD(draft.cost)}</bdi></dd></div>
            <div><dt>الهامش</dt><dd className={percent === null ? undefined : percent >= 0 ? 'positive' : 'negative'}><bdi dir="ltr">{percent === null ? '—' : `${percent}%`}</bdi></dd></div>
          </dl>
          <div className="studio-actions studio-card-actions">
            <button type="button" className="button small ghost" aria-label={`تعديل المسودة ${index + 1}`} disabled={generating} onClick={() => setEditing(index)}><PencilLine size={15} aria-hidden="true" />تعديل</button>
            <button type="button" className="button small" disabled={!project || saveState === 'managed' || saveState === 'saved' || (saveState === 'new' && !slots)} onClick={() => saveDrafts([index])}>
              {saveState === 'saved' ? <><Check size={15} aria-hidden="true" />تم الحفظ</>
                : saveState === 'managed' ? <><Check size={15} aria-hidden="true" />يُدار في المشروع</>
                : saveState === 'changed' ? <><RotateCw size={14} aria-hidden="true" />حدّث نسخة المشروع</>
                : <><Plus size={15} aria-hidden="true" />احفظ المسودة</>}
            </button>
          </div>
        </article>;
      })}
    </div>
    <section className="studio-launch" aria-labelledby="studio-launch-title">
      <div className="studio-launch-heading"><IconTile icon={ClipboardCheck} tone="mint" /><div><h3 id="studio-launch-title">قبل الإطلاق</h3><p dir="auto">{pack.launch.tagline}</p></div></div>
      <ol>{pack.launch.actions.map((action, index) => <li key={index}><bdi className="mono" aria-hidden="true">{String(index + 1).padStart(2, '0')}</bdi><p dir="auto">{action}</p></li>)}</ol>
    </section>
    <p className="studio-feedback field-note" role="status">{feedback || 'حزمة محفوظة في سجل هذا المتصفح. لا يتم نشر أي منتج من الاستوديو.'}</p>
    {showCopyText && <StudioCopyDialog text={packAsText(brief, pack, source)} onDownload={download} onClose={() => setShowCopyText(false)} />}
    {editingDraft && editing !== null && <StudioDraftDialog draft={editingDraft} onClose={() => setEditing(null)} onSave={(draft) => {
      useStudioStore.getState().editDraft(session.id, editing, draft);
      setFeedback('تم حفظ التعديلات في حزمة الاستوديو.');
      setEditing(null);
    }} />}
  </section>;
}
