import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, Copy, Terminal } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.js';
import { buildMissionEvents, type MissionEventSeverity, type MissionEventSource } from '../os/missionEvents.js';
import type { MissionDetail } from '../os/api.js';

const SOURCE_KEY: Record<MissionEventSource, string> = {
  task: 'workspace.eventTask',
  run: 'workspace.eventRun',
  handoff: 'workspace.eventHandoff',
  approval: 'workspace.eventApproval',
  verification: 'workspace.eventVerification',
  outcome: 'workspace.eventOutcome',
};

const SEVERITY_KEY: Record<MissionEventSeverity, string> = {
  info: 'workspace.logInfo',
  success: 'workspace.logSuccess',
  warning: 'workspace.logWarning',
  error: 'workspace.logError',
};

export function MissionLogPanel({ detail, showFilters = false, defaultOpen = true }: {
  detail: MissionDetail | null;
  showFilters?: boolean;
  defaultOpen?: boolean;
}) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const [filter, setFilter] = useState<'all' | MissionEventSeverity>('all');
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const events = useMemo(() => detail ? buildMissionEvents(detail, t) : [], [detail, t]);
  const visible = filter === 'all' ? events : events.filter((event) => event.severity === filter);

  useEffect(() => {
    if (!open || !bodyRef.current) return;
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [open, detail?.id, events.length]);

  async function copyLog() {
    const text = visible.map((event) => `${event.at}\t${event.severity}\t${event.source}\t${event.title}${event.detail ? `\t${event.detail}` : ''}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard may be unavailable; the log remains selectable */ }
  }

  const filters: Array<{ id: 'all' | MissionEventSeverity; label: string }> = [
    { id: 'all', label: t('workspace.logFilterAll') },
    { id: 'info', label: t('workspace.logInfo') },
    { id: 'success', label: t('workspace.logSuccess') },
    { id: 'warning', label: t('workspace.logWarning') },
    { id: 'error', label: t('workspace.logError') },
  ];

  return <section className="tech-log" aria-labelledby="tech-log-title">
    <div className="tech-panel-head">
      <div>
        <h2 id="tech-log-title"><Terminal size={15} aria-hidden="true" /> {t('workspace.logTitle')}</h2>
        <p>{t('workspace.logSubtitle')}</p>
      </div>
      <div className="tech-log-actions">
        {showFilters && <div className="tech-log-filters" role="group" aria-label={t('workspace.logTitle')}>
          {filters.map((item) => <button key={item.id} type="button" className="tech-filter" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}
        </div>}
        <button type="button" className="icon-button" disabled={visible.length === 0} onClick={() => void copyLog()} aria-label={t('workspace.logCopy')} title={copied ? t('workspace.logCopied') : t('workspace.logCopy')}>
          {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        </button>
        <button type="button" className="icon-button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={open ? t('workspace.logCollapse') : t('workspace.logExpand')} title={open ? t('workspace.logCollapse') : t('workspace.logExpand')}>
          {open ? <ChevronDown size={17} aria-hidden="true" /> : <ChevronLeft size={17} aria-hidden="true" />}
        </button>
      </div>
    </div>
    {open && (detail ? <div className="tech-log-body hq-scroll" ref={bodyRef} role="log" aria-label={t('workspace.logTitle')}>
      {visible.length === 0 ? <p className="tech-log-empty">{t('workspace.logEmpty')}</p> : visible.map((event) => (
        <div className="tech-log-line" key={event.id} data-severity={event.severity}>
          <time dateTime={event.at} dir="ltr">{new Date(event.at).toLocaleString(lang, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
          <span className="tech-log-severity">{t(SEVERITY_KEY[event.severity])}</span>
          <span className="tech-log-source">{t(SOURCE_KEY[event.source])}</span>
          <span className="tech-log-message"><bdi>{event.title}</bdi>{event.detail && <small><bdi>{event.detail}</bdi></small>}</span>
        </div>
      ))}
    </div> : <div className="tech-log-empty"><p>{t('workspace.logEmpty')}</p><small>{t('workspace.logReadOnly')}</small></div>)}
    <p className="tech-log-note">{t('workspace.logReadOnly')}</p>
  </section>;
}
