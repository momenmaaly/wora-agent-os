import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, FileText, History, LoaderCircle, LockKeyhole, Package, Sparkles } from 'lucide-react';
import studioArt from '../assets/studio-kit.webp';
import { PLANS } from '../billing/plans.js';
import { useBillingStore } from '../store/useBillingStore.js';
import { getStudioMode, requestStudioPack, StudioRequestError, type StudioMode } from '../studio/api.js';
import { MAX_AUDIENCE, MAX_IDEA, MIN_IDEA, POSITIONING, SOURCE_LABEL, STUDIO_EXAMPLES, makeTemplatePack, type StudioPack, type StudioPositioning, type StudioSource } from '../studio/drafts.js';
import { StudioHistoryDialog } from '../studio/StudioDialogs.js';
import { StudioResults } from '../studio/StudioResults.js';
import { useStudioStore } from '../studio/useStudioStore.js';
import { EmptyState, PageHeader } from './ui.js';
import '../styles/studio.css';

function errorMessage(error: unknown) {
  if (!(error instanceof StudioRequestError)) return 'لم يتم الاتصال بالتوليد المباشر. يمكنك إعادة المحاولة أو استخدام قالب محلي.';
  switch (error.code) {
    case 'STUDIO_RATE_LIMITED': return 'وصلت إلى حد التوليد المباشر. انتظر قليلاً أو استخدم قالباً محلياً.';
    case 'STUDIO_AUTH_REQUIRED': return 'انتهت جلسة التوليد المباشر. يمكنك إكمال العمل بقالب محلي.';
    case 'STUDIO_TIMEOUT': return 'استغرق التوليد وقتاً أطول من المتاح. موجزك لا يزال محفوظاً.';
    case 'STUDIO_BUSY': return 'خدمة التوليد مشغولة مؤقتاً. حاول لاحقاً أو استخدم قالباً محلياً.';
    default: return 'تعذّر تجهيز حزمة بالتوليد المباشر. موجزك لا يزال محفوظاً.';
  }
}

export function ProductStudio({ onUpgrade, onProjects }: { onUpgrade: () => void; onProjects: () => void }) {
  const plan = useBillingStore((state) => state.plan);
  const canGenerate = PLANS[plan].entitlements.productStudio;
  const { brief, sessions, activeId, setBrief, addSession, selectSession, deleteSession } = useStudioStore();
  const session = sessions.find((item) => item.id === activeId);
  const [status, setStatus] = useState<StudioMode | null>(null);
  const [preferTemplate, setPreferTemplate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [progress, setProgress] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const request = useRef<AbortController | null>(null);
  const ideaInput = useRef<HTMLTextAreaElement>(null);
  const resultTitle = useRef<HTMLHeadingElement>(null);
  const reveal = useRef(false);
  const source: StudioSource = status?.mode === 'live' && !preferTemplate ? 'live' : 'template';
  const ideaValid = brief.idea.trim().length >= MIN_IDEA;

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 3_500);
    void getStudioMode(controller.signal).then((mode) => { if (mounted) setStatus(mode); }).finally(() => window.clearTimeout(timer));
    return () => {
      mounted = false;
      window.clearTimeout(timer);
      controller.abort();
      request.current?.abort();
      request.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (!historyOpen && reveal.current && resultTitle.current) {
      reveal.current = false;
      resultTitle.current.focus({ preventScroll: true });
      resultTitle.current.scrollIntoView({ block: 'start' });
    }
  }, [session?.id, historyOpen]);

  async function generate(selected: StudioSource) {
    if (!canGenerate || !ideaValid || request.current) return;
    const snapshot = { ...brief, idea: brief.idea.trim(), audience: brief.audience.trim() };
    setFailure('');
    setProgress('');
    function show(pack: StudioPack) {
      reveal.current = true;
      addSession(snapshot, pack, selected);
    }
    if (selected === 'template') { show(makeTemplatePack(snapshot)); return; }

    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setProgress('جارٍ إعداد التصوّر والمسودات…');
    const timer = window.setTimeout(() => controller.abort(), 29_000);
    try {
      const pack = await requestStudioPack(snapshot, controller.signal);
      if (request.current === controller) show(pack);
    } catch (error) {
      if (request.current !== controller) return;
      setFailure(controller.signal.aborted ? 'انتهت مهلة الانتظار. يمكنك استخدام قالب محلي.' : errorMessage(error));
      if (error instanceof StudioRequestError && error.code === 'STUDIO_AUTH_REQUIRED') setStatus({ mode: 'template', reason: 'sign-in' });
    } finally {
      window.clearTimeout(timer);
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
        setProgress('');
      }
    }
  }

  function cancel() {
    const controller = request.current;
    request.current = null;
    controller?.abort();
    setBusy(false);
    setProgress('تم إلغاء التوليد. يمكنك متابعة تعديل الموجز.');
    window.requestAnimationFrame(() => ideaInput.current?.focus());
  }

  return <>
    <PageHeader icon={Sparkles} eyebrow="من الفكرة إلى المسودة" title="استوديو المنتج"
      description="ابدأ بموجز، راجع ثلاث مسودات، واحفظ ما يناسبك في مشروعك."
      action={<><span className="badge tint" dir="ltr"><Sparkles size={13} aria-hidden="true" /> WORA PRO</span>
        <button className="button ghost studio-history-button" type="button" disabled={busy} onClick={() => setHistoryOpen(true)}><History size={17} aria-hidden="true" />سجل الحزم <bdi className="studio-counter">{sessions.length}</bdi></button></>} />
    <div className="studio-layout">
      <form className="panel panel-pad studio-brief" onSubmit={(event) => { event.preventDefault(); void generate(source); }}>
        <div className="section-bar studio-brief-heading">
          <div><div className="studio-kicker"><bdi className="studio-step mono" dir="ltr">01</bdi> مدخلات الاستوديو</div><h2>موجز فكرتك</h2></div>
          <span className={`badge tint ${source === 'live' ? 'tone-mint' : 'tone-violet'}`}><span className="status-dot" />{SOURCE_LABEL[source]}</span>
        </div>
        <fieldset className="studio-brief-fields" disabled={busy}>
          <div className="studio-idea-field">
            <label className="label">وصف الفكرة<textarea className="field" ref={ideaInput} name="idea" value={brief.idea} maxLength={MAX_IDEA} minLength={MIN_IDEA} required dir="auto"
              placeholder="مثال: مجموعة قهوة مختصّة بتغليف مستدام…" aria-describedby="studio-idea-note" onChange={(event) => { setBrief({ idea: event.target.value }); setFailure(''); setProgress(''); }} rows={3} /></label>
            <div className="studio-field-meta" id="studio-idea-note"><span>اكتب ما يميّز المنتج في جملة واحدة.</span><bdi dir="ltr">{brief.idea.length} / {MAX_IDEA}</bdi></div>
          </div>
          <div className="field-grid studio-brief-grid">
            <label className="label"><span>الجمهور <span className="field-note">(اختياري)</span></span><input className="field" name="audience" value={brief.audience} dir="auto" maxLength={MAX_AUDIENCE} placeholder="مثال: عشّاق القهوة في المنزل" onChange={(event) => setBrief({ audience: event.target.value })} /></label>
            <label className="label">مستوى التسعير<select className="field" name="positioning" value={brief.positioning} onChange={(event) => setBrief({ positioning: event.target.value as StudioPositioning })}>
              {Object.entries(POSITIONING).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select></label>
          </div>
          <div className="filter-row studio-examples"><span>جرّب مثالاً</span>{STUDIO_EXAMPLES.map((example) => <button className="filter-chip" type="button" key={example.label} onClick={() => { setBrief(example.brief); setFailure(''); setProgress(''); }}>{example.label}</button>)}</div>
        </fieldset>
        <div className="studio-submit">
          {canGenerate ? <button type="submit" className="button primary" disabled={busy || !ideaValid}>
            {busy ? <><LoaderCircle className="studio-spinner" size={17} aria-hidden="true" />جارٍ التوليد</> : <><Sparkles size={17} aria-hidden="true" />أنشئ مسودات</>}
          </button> : <button type="button" className="button primary" onClick={onUpgrade}><LockKeyhole size={16} aria-hidden="true" />جرّب الاستوديو مع Pro</button>}
          {busy ? <button type="button" className="button ghost" onClick={cancel}>إلغاء الطلب</button>
            : status?.mode === 'live' && <button type="button" className="text-link" onClick={() => { setPreferTemplate((value) => !value); setFailure(''); }}>{preferTemplate ? 'استخدم التوليد المباشر' : 'استخدم قالباً محلياً'}</button>}
        </div>
        <p className="field-note studio-mode-note">{!canGenerate ? 'تجربة Pro تفتح الاستوديو هنا من دون دفع.'
          : source === 'live' ? 'يُرسل الموجز للمزوّد عند التوليد. لا تُدخل معلومات حسّاسة.'
          : status?.mode === 'template' && status.reason === 'sign-in' ? 'التوليد المباشر يحتاج جلسة عمل. القالب يعمل محلياً.'
          : 'القوالب تعمل على جهازك ولا تُرسل الموجز لمزوّد خارجي.'}</p>
        <p className="field-note studio-progress" role="status">{progress}</p>
        {failure && <div className="studio-failure">
          <p role="alert">{failure}</p>
          <button type="button" className="button small" disabled={!ideaValid || !canGenerate} onClick={() => { setPreferTemplate(true); void generate('template'); }}><FileText size={15} aria-hidden="true" />أنشئ من قالب محلي</button>
        </div>}
      </form>
      <aside className="panel studio-guide" aria-labelledby="studio-guide-title">
        <div className="studio-guide-visual">
          <img src={studioArt} alt="" width={960} height={644} />
          <span className="studio-art-label mono" dir="ltr"><span /> WORA / STUDIO KIT</span>
        </div>
        <div className="studio-guide-copy">
          <h2 id="studio-guide-title">جرّبها كمسودة أولاً.</h2>
          <p>ثلاثة تصوّرات بأسعار وتكاليف تقديرية، وخطوات لمراجعتها قبل الإطلاق.</p>
          <div className="studio-guide-flow"><FileText size={16} aria-hidden="true" />موجز <ArrowLeft size={14} aria-hidden="true" /> مراجعة <ArrowLeft size={14} aria-hidden="true" /> حفظ في مشروع</div>
        </div>
      </aside>
    </div>
    {session ? <StudioResults key={session.id} session={session} generating={busy} titleRef={resultTitle} onProjects={onProjects} onReuseBrief={() => {
      setBrief(session.brief);
      setFailure('');
      setProgress('');
      ideaInput.current?.focus({ preventScroll: true });
      ideaInput.current?.scrollIntoView({ block: 'center' });
    }} /> : <div className="studio-empty"><EmptyState icon={Package} title="حزمة المسودات تظهر هنا">{canGenerate ? 'اكتب فكرتك أو جرّب أحد الأمثلة للبدء.' : 'فعّل معاينة Pro لتجربة إنشاء المسودات.'}</EmptyState></div>}
    {historyOpen && <StudioHistoryDialog sessions={sessions} activeId={session?.id} onClose={() => setHistoryOpen(false)} onDelete={deleteSession} onSelect={(id) => {
      reveal.current = true;
      selectSession(id);
      setHistoryOpen(false);
    }} />}
  </>;
}
