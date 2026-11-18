import { useEffect, useRef, useState, type FormEvent } from 'react';
import { clearWorkspaceSession, connectWorkspace, isSessionError, readSessionToken } from '../lib/session.js';
import { useWoraStore } from '../store/useWoraStore.js';
import { ConnectionBadge } from './OfficePeople.js';

export function WorkspaceSession() {
  const connected = useWoraStore((s) => s.connected);
  const mode = useWoraStore((s) => s.serverMode);
  const connectionError = useWoraStore((s) => s.connectionError);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const hasSession = Boolean(readSessionToken());
  useEffect(() => () => request.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    const form = event.currentTarget;
    const token = new FormData(form).get('workspaceSession');
    if (typeof token !== 'string') return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError('');
    try {
      await connectWorkspace(token, controller.signal);
      form.reset();
      // Reopen the socket with the verified identity; existing browser drafts are untouched.
      window.location.reload();
    } catch (cause) {
      if (controller.signal.aborted) return;
      const code = cause instanceof Error ? cause.message : '';
      setError(code === 'AUTH_INVALID' ? 'رمز الجلسة غير صالح أو منتهي. اطلب رمزًا جديدًا من مسؤول المساحة.'
        : code === 'STORAGE_UNAVAILABLE' ? 'هذا المتصفح لا يسمح بحفظ الجلسة في التبويب. فعّل تخزين الجلسة وحاول مجددًا.'
          : 'تعذّر التحقق من الجلسة. تأكد من تشغيل خادم مساحة العمل ثم حاول مرة أخرى.');
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  return <section className="panel panel-pad field-stack workspace-session" aria-labelledby="workspace-session-title">
    <div className="workspace-session-heading"><h2 id="workspace-session-title">جلسة مساحة العمل</h2><ConnectionBadge /></div>
    <p className="field-note">اتصل بمساحتك الخاصة برمز مؤقت من مسؤول التشغيل. لا تدخل مفتاح مزوّد الذكاء الاصطناعي أو مفتاح إدارة الخادم.</p>
    {connectionError === 'SESSION_EXPIRED' && <p role="status">انتهت صلاحية الجلسة. أدخل رمزًا جديدًا لإعادة الاتصال.</p>}
    {connected && mode === 'preview' && <p className="field-note">أنت متصل بخادم معاينة. الرسائل والمهام المحفوظة عليه مؤقتة.</p>}
    {hasSession && connected && mode === 'server' ? null : <form className="field-stack" onSubmit={submit}>
      <label htmlFor="workspace-session-input">رمز الجلسة</label>
      <input id="workspace-session-input" className="field" name="workspaceSession" type="password" required maxLength={4096}
        autoComplete="off" spellCheck={false} dir="ltr" disabled={pending} />
      <div><button type="submit" className="button primary" disabled={pending}>{pending ? 'جارٍ التحقق…' : 'اتصال بمساحة العمل'}</button></div>
      {error && <p className="field-note" role="alert">{error}</p>}
    </form>}
    {hasSession && <div className="workspace-session-actions">
      {!connected && !isSessionError(connectionError) && <button className="button" type="button" disabled={pending} onClick={() => window.location.reload()}>إعادة الاتصال</button>}
      <button className="button" type="button" disabled={pending} onClick={() => { clearWorkspaceSession(); window.location.reload(); }}>إنهاء الجلسة في المتصفح</button>
    </div>}
    <p className="field-note">المشاريع ومسودات الاستوديو محفوظة في هذا المتصفح ولا تُزامَن مع الخادم عند الاتصال.</p>
  </section>;
}
