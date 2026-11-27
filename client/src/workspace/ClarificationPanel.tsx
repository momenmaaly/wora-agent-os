import { MessageCircleQuestion } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.js';
import type { ClarificationPlan } from '../os/api.js';

export function ClarificationPanel({ plan, answers, onChange }: {
  plan: ClarificationPlan;
  answers: Record<string, string>;
  onChange: (questionId: string, value: string) => void;
}) {
  const { t } = useI18n();
  if (!plan.questions.length) return null;
  return <section className="op-clarify" aria-labelledby="op-clarify-title">
    <header className="op-clarify-head">
      <div>
        <p className="op-kicker"><MessageCircleQuestion size={14} aria-hidden="true" />{t('op.clarify.kicker')}</p>
        <h3 id="op-clarify-title">{t('op.clarify.title')}</h3>
        <p>{plan.summary}</p>
      </div>
      {plan.criticalCount > 0 && <span className="op-chip op-chip-warn">{plan.criticalCount} {t('op.clarify.critical')}</span>}
    </header>
    <div className="op-clarify-list">
      {plan.questions.map((question) => <div key={question.id} className={`op-clarify-item${question.blocking ? ' is-blocking' : ''}`}>
        <div className="op-clarify-meta">
          <span className="os-chip small">{t(`op.clarify.code.${question.code}`)}</span>
          {question.blocking && <span className="op-clarify-badge">{t('op.clarify.critical')}</span>}
          <span className="op-muted">{t(`op.clarify.materiality.${question.materiality}`)}</span>
        </div>
        <label htmlFor={`op-clarify-${question.id}`} dir="auto">{question.prompt}</label>
        {question.fields.length > 0 && <p className="op-muted">{t('op.clarify.fields')}: {question.fields.join(' · ')}</p>}
        <textarea
          id={`op-clarify-${question.id}`}
          rows={2}
          dir="auto"
          value={answers[question.id] ?? ''}
          onChange={(event) => onChange(question.id, event.target.value)}
          placeholder={t('op.clarify.answerPlaceholder')}
        />
      </div>)}
    </div>
    <p className="op-muted">{t('op.clarify.skipHint')}</p>
  </section>;
}
