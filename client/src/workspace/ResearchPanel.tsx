import { BookOpen, Search, ShieldAlert } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.js';
import type { ResearchPlan } from '../os/api.js';

export function ResearchPanel({ plan }: { plan: ResearchPlan }) {
  const { t } = useI18n();
  if (!plan.needed) return null;
  return <section className="op-research" data-status={plan.status} aria-labelledby="op-research-title">
    <header className="op-research-head">
      <div>
        <p className="op-kicker"><Search size={14} aria-hidden="true" />{t('op.research.kicker')}</p>
        <h3 id="op-research-title">{t('op.research.title')}</h3>
        <p>{plan.reason}</p>
      </div>
      <span className="op-chip">{t(`op.research.status.${plan.status}`)}</span>
    </header>
    {plan.questions.length > 0 && <div className="op-research-block">
      <h4><BookOpen size={13} aria-hidden="true" />{t('op.research.questions')}</h4>
      <ul className="op-list">{plan.questions.slice(0, 6).map((question) => <li key={question.id}>
        <span dir="auto">{question.question}</span><small>{t(`op.research.materiality.${question.materiality}`)}</small>
      </li>)}</ul>
    </div>}
    <div className="op-research-block">
      <h4>{t('op.research.sources')}</h4>
      {plan.sources.length === 0
        ? <p className="op-alert" role="status"><ShieldAlert size={14} aria-hidden="true" />{t('op.research.noSources')}</p>
        : <ul className="op-list">{plan.sources.map((source) => <li key={source.id}>
          <span dir="auto"><strong>{source.title}</strong><small>{source.kind} · {source.tool}</small></span>
        </li>)}</ul>}
    </div>
    {plan.limitations.length > 0 && <details className="op-evidence">
      <summary>{t('op.research.limitations')}</summary>
      <ul className="op-list">{plan.limitations.slice(0, 5).map((item) => <li key={item} dir="auto">{item}</li>)}</ul>
    </details>}
  </section>;
}
