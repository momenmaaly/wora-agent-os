import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpLeft, Copy, Download, History, PencilLine, Trash2 } from 'lucide-react';
import { Dialog, EmptyState, IconButton } from '../components/ui.js';
import { MAX_DRAFT_MONEY, SOURCE_LABEL, type StudioDraft } from './drafts.js';
import { STUDIO_HISTORY_LIMIT, type StudioSession } from './useStudioStore.js';

const dateFormat = new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });

export function StudioDraftDialog({ draft, onSave, onClose }: { draft: StudioDraft; onSave: (draft: StudioDraft) => void; onClose: () => void }) {
  const formId = useId();
  const [error, setError] = useState('');

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const get = (key: string) => String(data.get(key) ?? '').trim();
    const name = get('name');
    const description = get('description');
    const category = get('category');
    const toAmount = (key: string) => get(key) ? Number(get(key)) : NaN;
    const price = toAmount('price');
    const cost = toAmount('cost');
    if (!name || !description || !category) {
      setError('أدخل اسماً ووصفاً وفئة للمسودة.');
      return;
    }
    if (![price, cost].every((number) => Number.isFinite(number) && number >= 0 && number <= MAX_DRAFT_MONEY)) {
      setError('أدخل قيماً صحيحة وغير سالبة للسعر والتكلفة.');
      return;
    }
    onSave({ name, description, category, price: Math.round(price * 100) / 100, cost: Math.round(cost * 100) / 100 });
  }

  return <Dialog icon={PencilLine} title="تعديل مسودة المنتج" description="التعديل يُحفظ في حزمة الاستوديو أولاً. يمكنك بعدها تحديث نسخة المشروع."
    onClose={onClose} footer={<>
      <button type="button" className="button ghost" onClick={onClose}>إلغاء</button>
      <button className="button primary" type="submit" form={formId}>احفظ التعديلات</button>
    </>}>
    <form className="field-stack" id={formId} onSubmit={save} onChange={() => setError('')}>
      <label className="label">اسم المنتج<input className="field" name="name" dir="auto" required maxLength={100} defaultValue={draft.name} data-initial-focus /></label>
      <label className="label">الفئة<input className="field" name="category" dir="auto" required maxLength={60} defaultValue={draft.category} /></label>
      <label className="label">وصف المنتج<textarea className="field" name="description" dir="auto" required maxLength={420} rows={3} defaultValue={draft.description} /></label>
      <div className="field-grid studio-money-fields">
        <label className="label">السعر بالدولار<input className="field" name="price" dir="ltr" lang="en" type="number" required min={0} max={MAX_DRAFT_MONEY} step="0.01" inputMode="decimal" defaultValue={draft.price} /></label>
        <label className="label">التكلفة بالدولار<input className="field" name="cost" dir="ltr" lang="en" type="number" required min={0} max={MAX_DRAFT_MONEY} step="0.01" inputMode="decimal" defaultValue={draft.cost} /></label>
      </div>
      {error && <p className="studio-error-text" role="alert">{error}</p>}
    </form>
  </Dialog>;
}

export function StudioCopyDialog({ text, onDownload, onClose }: { text: string; onDownload: () => void; onClose: () => void }) {
  return <Dialog icon={Copy} title="نسخ نص الحزمة" description="المتصفّح لم يسمح بالنسخ التلقائي. يمكنك نسخ النص المحدّد يدوياً أو تنزيل الملف." onClose={onClose}
    footer={<>
      <button type="button" className="button ghost" onClick={onClose}>تم</button>
      <button type="button" className="button primary" onClick={() => { onDownload(); onClose(); }}><Download size={16} aria-hidden="true" />تنزيل الملف النصّي</button>
    </>}>
    <label className="label">نص الحزمة<textarea className="field studio-copy-text" rows={7} dir="auto" readOnly value={text} data-initial-focus onFocus={(event) => event.currentTarget.select()} /></label>
  </Dialog>;
}

export function StudioHistoryDialog({ sessions, activeId, onSelect, onDelete, onClose }: {
  sessions: StudioSession[];
  activeId?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [removeId, setRemoveId] = useState<string | null>(null);
  const removing = sessions.find((session) => session.id === removeId);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const firstItem = useRef<HTMLButtonElement>(null);
  const lastDeleteButton = useRef<HTMLButtonElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (removing) cancelButton.current?.focus();
    else if (lastDeleteButton.current) {
      (lastDeleteButton.current.isConnected ? lastDeleteButton.current : firstItem.current ?? closeButton.current)?.focus();
      lastDeleteButton.current = null;
    }
  }, [removing]);

  return <Dialog icon={removing ? Trash2 : History} title={removing ? 'حذف الحزمة؟' : 'سجل الحزم'}
    description={removing ? 'سيُحذف محتوى الحزمة من الاستوديو فقط. نسخ المشروع لن تتأثّر.' : `تُحفظ آخر ${STUDIO_HISTORY_LIMIT} حزم في هذا المتصفح، بما في ذلك تعديلاتك.`}
    onClose={() => removing ? setRemoveId(null) : onClose()}
    footer={removing ? <>
      <button className="button" type="button" ref={cancelButton} onClick={() => setRemoveId(null)}>إلغاء</button>
      <button className="button danger" type="button" onClick={() => { onDelete(removing.id); setRemoveId(null); }}>احذف الحزمة</button>
    </> : <button className="button" type="button" ref={closeButton} onClick={onClose}>رجوع إلى الاستوديو</button>}>
    <div hidden={Boolean(removing)}>
      {sessions.length ? <ul className="studio-history-list">{sessions.map((session, index) => <li key={session.id}>
        <button className="studio-history-item" type="button" aria-current={session.id === activeId ? 'true' : undefined}
          ref={index === 0 ? firstItem : undefined} data-initial-focus={index === 0 ? true : undefined} onClick={() => onSelect(session.id)}>
          <span>
            <strong dir="auto">{session.pack.title}</strong>
            <small><time dateTime={session.createdAt}>{dateFormat.format(new Date(session.createdAt))}</time><span aria-hidden="true"> · </span>{SOURCE_LABEL[session.source]}</small>
          </span>
          <ArrowUpLeft size={16} aria-hidden="true" />
        </button>
        <IconButton icon={Trash2} label={`حذف حزمة ${session.pack.title}`} onClick={(event) => { lastDeleteButton.current = event.currentTarget; setRemoveId(session.id); }} />
      </li>)}</ul> : <EmptyState icon={History} title="لا توجد حزم بعد">ستظهر مجموعات مسوداتك هنا بعد إنشائها.</EmptyState>}
    </div>
    {removing && <p className="studio-confirm-title" dir="auto">{removing.pack.title}</p>}
  </Dialog>;
}
