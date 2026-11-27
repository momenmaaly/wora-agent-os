import { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, CircleAlert, CircleDashed, FileText, Monitor, Play, RefreshCw, ShieldCheck, Square } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.js';
import { Button, StateMessage } from './ui.js';
import { formatDate } from '../workspace/model.js';
import { RuntimeApiError, runtimeApi, type RuntimeArtifact, type RuntimeSession, type RuntimeStatusResponse } from '../runtime/api.js';

function errorText(error: unknown, fallback: string): string {
  return error instanceof RuntimeApiError ? error.message : error instanceof Error ? error.message : fallback;
}

function ArtifactImage({ artifact, onOpen }: { artifact: RuntimeArtifact; onOpen: (blob: Blob, name: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    void runtimeApi.artifactBlob(artifact.id).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [artifact.id]);
  if (error) return <span className="runtime-artifact-fallback"><Camera size={15} aria-hidden="true" />{artifact.name}</span>;
  if (!url) return <span className="runtime-artifact-loading">{artifact.name}…</span>;
  return <button type="button" className="runtime-shot" onClick={() => void fetchAndOpen(artifact, onOpen)} aria-label={artifact.name}>
    <img src={url} alt={artifact.name} loading="lazy" />
  </button>;
}

async function fetchAndOpen(artifact: RuntimeArtifact, onOpen: (blob: Blob, name: string) => void) {
  const blob = await runtimeApi.artifactBlob(artifact.id);
  onOpen(blob, artifact.name);
}

export function RuntimePanel({ missionId, showArtifacts = true, compact = false }: { missionId?: string; showArtifacts?: boolean; compact?: boolean }) {
  const { t, lang } = useI18n();
  const [status, setStatus] = useState<RuntimeStatusResponse | null>(null);
  const [sessions, setSessions] = useState<{ computer: RuntimeSession[]; browser: RuntimeSession[] } | null>(null);
  const [artifacts, setArtifacts] = useState<RuntimeArtifact[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextStatus, nextSessions, nextArtifacts] = await Promise.all([
        runtimeApi.status(), runtimeApi.sessions(missionId), showArtifacts ? runtimeApi.artifacts(missionId) : Promise.resolve([]),
      ]);
      setStatus(nextStatus); setSessions(nextSessions); setArtifacts(nextArtifacts);
    } catch (err) { setError(errorText(err, t('op.runtime.loadError'))); }
  }, [missionId, showArtifacts, t]);

  useEffect(() => { void load(); }, [load]);

  async function action(key: string, fn: () => Promise<unknown>, message: string) {
    setBusy(key); setError(null); setNotice(null);
    try { await fn(); await load(); setNotice(message); }
    catch (err) { setError(errorText(err, t('op.runtime.actionError'))); }
    finally { setBusy(null); }
  }

  function openBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const allSessions = useMemo(() => [...(sessions?.computer ?? []), ...(sessions?.browser ?? [])], [sessions]);
  const screenshots = (artifacts ?? []).filter((artifact) => artifact.kind === 'screenshot');
  const documents = (artifacts ?? []).filter((artifact) => artifact.kind !== 'screenshot');
  const cloud = status?.cloud;
  const browser = status?.browser;
  const browserState = !browser?.available ? 'unavailable' : browser.isolated ? 'available' : 'partial';

  return <section className={`op-panel runtime-panel${compact ? ' is-compact' : ''}`} aria-labelledby="runtime-panel-title">
    <div className="op-panel-head">
      <div><h2 id="runtime-panel-title">{t('op.runtime.title')}</h2><p>{t('op.runtime.subtitle')}</p></div>
      <button type="button" className="icon-button" onClick={() => void load()} aria-label={t('op.refresh')} title={t('op.refresh')}><RefreshCw size={15} aria-hidden="true" /></button>
    </div>
    {!status && !error && <StateMessage variant="loading" title={t('op.loading')} />}
    {error && <div className="op-alert" role="alert"><CircleAlert size={15} aria-hidden="true" />{error}</div>}
    {notice && <p className="op-notice" role="status">{notice}</p>}
    {cloud && <div className="runtime-availability">
      <span data-state={!cloud.operational ? 'unavailable' : cloud.isolated ? 'available' : 'partial'}><Monitor size={14} aria-hidden="true" />{t('op.runtime.cloudComputer')}: {!cloud.operational ? t('op.runtime.unavailable') : cloud.isolated ? t('op.runtime.operational') : t('op.runtime.nonIsolated')}</span>
      <span data-state={browserState}><Camera size={14} aria-hidden="true" />{t('op.runtime.browserAutomation')}: {!browser?.available ? t('op.runtime.unavailable') : browser.isolated ? t('op.runtime.operational') : t('op.runtime.nonIsolated')}</span>
    </div>}
    {cloud && <dl className="op-meta-list">
      <div><dt>{t('op.runtime.provider')}</dt><dd>{cloud.selected ?? '—'} {cloud.isolated ? `· ${t('op.runtime.isolated')}` : `· ${t('op.runtime.nonIsolated')}`}</dd></div>
      <div><dt>{t('op.runtime.activeSessions')}</dt><dd>{cloud.activeSessions}</dd></div>
      <div><dt>{t('op.runtime.failedSessions')}</dt><dd>{cloud.failedSessions}</dd></div>
      <div><dt>{t('op.runtime.limits')}</dt><dd>{cloud.limits.cpus} CPU · {cloud.limits.memoryMb} MB · {cloud.limits.timeoutMs} ms</dd></div>
    </dl>}
    {cloud && !cloud.operational && <p className="op-muted">{cloud.truth}</p>}
    {browser && <div className="op-meta-list"><div><dt>{t('op.runtime.provider')}</dt><dd>{browser.provider ?? '—'}{browser.sandbox ? ` · ${t('op.runtime.sandbox')}: ${browser.sandbox}` : ''}</dd></div></div>}
    {browser && !browser.available && <p className="op-muted">{browser.reason}</p>}
    {browser?.available && !browser.isolated && <p className="op-muted">{browser.reason}</p>}
    {(cloud?.operational || status?.browser.available) && <div className="op-actions">
      {cloud?.operational && <Button size="small" variant="secondary" icon={Play} loading={busy === 'computer'} onClick={() => void action('computer', () => runtimeApi.start('computer'), t('op.runtime.started'))}>{t('op.runtime.startComputer')}</Button>}
      {browser?.available && <Button size="small" variant="secondary" icon={Play} loading={busy === 'browser'} onClick={() => void action('browser', () => runtimeApi.start('browser'), t('op.runtime.started'))}>{t('op.runtime.startBrowser')}</Button>}
    </div>}

    {sessions && allSessions.length === 0 && <div className="op-empty"><CircleDashed size={20} aria-hidden="true" /><strong>{t('op.runtime.noSessions')}</strong><p>{t('op.runtime.noSessionsBody')}</p></div>}
    {allSessions.length > 0 && <ul className="runtime-session-list">
      {allSessions.map((session) => <li key={session.id}>
        <span className="runtime-session-icon">{session.kind === 'browser' ? <Camera size={15} aria-hidden="true" /> : <Monitor size={15} aria-hidden="true" />}</span>
        <span className="runtime-session-copy"><strong>{session.kind === 'browser' ? t('op.runtime.browserSession') : t('op.runtime.computerSession')} · {session.status}</strong>
          <small>{session.provider}{session.metadata?.currentUrl ? ` · ${session.metadata.currentUrl}` : ''}{session.metadata?.currentTitle ? ` · ${session.metadata.currentTitle}` : ''}</small>
          <small>{formatDate(session.startedAt ?? session.createdAt, lang)}</small>
          {session.error && <small className="os-bad">{session.error}</small>}
        </span>
        {['starting', 'running'].includes(session.status) && <button type="button" className="button small ghost" disabled={busy === session.id} onClick={() => void action(session.id, () => runtimeApi.stop(session.id), t('op.runtime.stopped'))}>{busy === session.id ? '…' : <><Square size={13} aria-hidden="true" />{t('op.runtime.stop')}</>}</button>}
      </li>)}
    </ul>}

    {showArtifacts && <div className="runtime-artifacts">
      <div className="op-panel-head"><div><h3>{t('op.runtime.artifacts')}</h3><p>{t('op.runtime.artifactsHint')}</p></div></div>
      {artifacts && artifacts.length === 0 && <p className="op-muted">{t('op.runtime.noArtifacts')}</p>}
      {screenshots.length > 0 && <div className="runtime-screenshot-grid">{screenshots.map((artifact) => <ArtifactImage key={artifact.id} artifact={artifact} onOpen={openBlob} />)}</div>}
      {documents.length > 0 && <ul className="op-artifact-list">{documents.map((artifact) => <li key={artifact.id}>
        <FileText size={15} aria-hidden="true" /><span><strong>{artifact.name}</strong><small>{artifact.kind} · {artifact.mimeType} · {artifact.sizeBytes} B</small></span>
        <Button size="small" icon={FileText} onClick={() => void fetchAndOpen(artifact, openBlob)}>{t('op.runtime.download')}</Button>
      </li>)}</ul>}
    </div>}
    {cloud && <p className="op-muted runtime-truth"><ShieldCheck size={13} aria-hidden="true" />{cloud.truth}</p>}
  </section>;
}
