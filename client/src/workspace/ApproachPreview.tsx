import { GitBranch, ShieldCheck, Users } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.js';
import type { ApproachPreview } from '../os/api.js';

export function ApproachPreviewPanel({ preview, advanced }: { preview: ApproachPreview; advanced: boolean }) {
  const { t } = useI18n();
  const method = preview.problem.scientific?.method ?? null;
  const methodName = method?.name ?? preview.problem.algorithmSelection.primary?.name ?? null;
  const missing = [
    ...preview.problem.missingInformation,
    ...(preview.problem.scientific?.missingInformation ?? []),
  ];

  return <section className="op-approach" data-domain={preview.problem.domain} aria-labelledby="op-approach-title">
    <header className="op-approach-head">
      <div>
        <p className="op-kicker">{t('op.experience.previewTitle')}</p>
        <h3 id="op-approach-title">{preview.problem.domain.replace(/_/g, ' ')}</h3>
        <p>{t('op.experience.previewHint')}</p>
      </div>
      <span className="op-chip">{t('op.experience.confidence')}: {Math.round(preview.problem.confidence * 100)}%</span>
    </header>

    <div className="op-approach-grid">
      <section className="op-approach-section">
        <h4>{t('op.experience.method')}</h4>
        {methodName ? <><strong>{methodName}</strong>{method && <p className="op-muted">{method.guarantee}</p>}</> : <p className="op-muted">{t('op.experience.noMethod')}</p>}
        {advanced && preview.problem.algorithmSelection.rationale.length > 0 && <ul className="op-list">{preview.problem.algorithmSelection.rationale.slice(0, 4).map((reason) => <li key={reason}>{reason}</li>)}</ul>}
      </section>

      <section className="op-approach-section">
        <h4><GitBranch size={14} aria-hidden="true" />{t('op.experience.plan')}</h4>
        {preview.plan.length === 0 && <p className="op-muted">{t('op.experience.noPlan')}</p>}
        <ol className="op-approach-plan">{preview.plan.slice(0, advanced ? 8 : 4).map((task, index) => <li key={`${task.title}-${index}`}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <div><strong dir="auto">{task.title}</strong><small>{task.specialization.replace(/_/g, ' ')}{task.tool ? ` · ${task.tool}` : ''}</small></div>
        </li>)}</ol>
      </section>

      <section className="op-approach-section">
        <h4><Users size={14} aria-hidden="true" />{t('op.experience.team')}</h4>
        {preview.team.team.length === 0 && <p className="op-muted">{t('op.experience.noPlan')}</p>}
        <ul className="op-approach-team">{preview.team.team.slice(0, advanced ? 6 : 3).map((member) => <li key={member.agentId}>
          <strong>{member.name}</strong><small>{member.specialization.replace(/_/g, ' ')} · {Math.round(member.confidence * 100)}%</small>
        </li>)}</ul>
        {preview.team.gaps.length > 0 && <p className="op-alert" role="status"><ShieldCheck size={14} aria-hidden="true" />{t('op.experience.gaps')}: {preview.team.gaps.length}</p>}
      </section>
    </div>

    {advanced && <>
      {preview.problem.scientific && <section className="op-approach-advanced">
        <h4>{t('op.experience.scientific')}</h4>
        <p><strong>{preview.problem.scientific.domainName ?? preview.problem.scientific.domain ?? '—'}</strong> · {preview.problem.scientific.status}</p>
        {preview.problem.scientific.rejectedAlternatives.length > 0 && <details className="op-evidence"><summary>{t('op.experience.rejected')}</summary><ul className="op-list">{preview.problem.scientific.rejectedAlternatives.slice(0, 6).map((item) => <li key={item.name}><strong>{item.name}</strong> — {item.reason}</li>)}</ul></details>}
      </section>}
      {missing.length > 0 && <section className="op-approach-advanced"><h4>{t('op.experience.missing')}</h4><ul className="op-list">{missing.slice(0, 8).map((item) => <li key={item}>{item}</li>)}</ul></section>}
      {preview.requirements.length > 0 && <section className="op-approach-advanced"><h4>{t('op.experience.requirements')}</h4><ul className="op-list">{preview.requirements.slice(0, 8).map((item) => <li key={item.id}><strong>{item.label}</strong><small>{item.requiredTools.join(', ') || '—'} · {item.risk}</small></li>)}</ul></section>}
      <p className="op-muted">{t('op.experience.adjustHint')}</p>
    </>}
  </section>;
}
