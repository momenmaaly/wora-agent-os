import { useCallback, useEffect, useState } from 'react';
import { Check, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.js';
import { OsApiError, osApi, type ApprovalRecord } from '../os/api.js';
import { riskLabel } from '../os/labels.js';
import type { PageId } from '../pages.js';
import { Button, EmptyState, PageHeader, RiskBadge, StateMessage } from './ui.js';

export function ApprovalsPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { t, lang } = useI18n();
  const [approvals, setApprovals] = useState<ApprovalRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setApprovals(await osApi.approvals('pending')); }
    catch (err) { setApprovals([]); setError(err instanceof OsApiError ? err.message : t('approvals.error')); }
    finally { setLoading(false); }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  async function decide(id: string, decision: 'approved' | 'denied') {
    if (busy) return;
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      await osApi.decideApproval(id, decision);
      setNotice(decision === 'approved' ? t('approvals.approved') : t('approvals.denied'));
      await load();
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : t('approvals.error'));
    } finally { setBusy(null); }
  }

  return <div className="tech-page">
    <PageHeader icon={ShieldCheck} eyebrow={t('approvals.eyebrow')} title={t('approvals.title')} description={t('approvals.subtitle')}
      action={<button type="button" className="icon-button" onClick={() => void load()} aria-label={t('approvals.refresh')} title={t('approvals.refresh')}><RefreshCw size={16} aria-hidden="true" /></button>} />
    {notice && <StateMessage variant="success" title={notice} />}
    {loading && <StateMessage variant="loading" title={t('app.loading')} />}
    {!loading && error && <StateMessage variant="error" title={t('approvals.error')}><p>{error}</p><button type="button" className="button small" onClick={() => void load()}>{t('workspace.retry')}</button></StateMessage>}
    {!loading && !error && approvals?.length === 0 && <EmptyState icon={ShieldCheck} title={t('approvals.empty')}><p>{t('approvals.emptyBody')}</p></EmptyState>}
    {!loading && approvals && approvals.length > 0 && <ul className="tech-approval-list">
      {approvals.map((approval) => <li key={approval.id} className="tech-approval">
        <div className="tech-approval-head">
          <div><span className="tech-scope">{approval.toolId ?? approval.kind}</span><RiskBadge risk={approval.risk} label={riskLabel(t, approval.risk)} /></div>
          <time dateTime={approval.createdAt}>{new Date(approval.createdAt).toLocaleString(lang)}</time>
        </div>
        <h2 dir="auto">{approval.actionSummary}</h2>
        <dl>
          {approval.target && <><dt>{t('approvals.target')}</dt><dd dir="auto">{approval.target}</dd></>}
          {approval.consequences && <><dt>{t('approvals.consequences')}</dt><dd dir="auto">{approval.consequences}</dd></>}
          {approval.resourceImpact && <><dt>{t('approvals.resourceImpact')}</dt><dd dir="auto">{approval.resourceImpact}</dd></>}
        </dl>
        <div className="tech-approval-actions">
          <Button variant="primary" size="small" loading={busy === approval.id} icon={Check} onClick={() => void decide(approval.id, 'approved')}>{t('approvals.approve')}</Button>
          <Button variant="destructive" size="small" icon={X} disabled={busy === approval.id} onClick={() => void decide(approval.id, 'denied')}>{t('approvals.deny')}</Button>
          <button type="button" className="tech-text-link" onClick={() => onNavigate('execution')}>{t('approvals.openMission')}</button>
        </div>
      </li>)}
    </ul>}
  </div>;
}
