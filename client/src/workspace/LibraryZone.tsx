import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { BookOpen, CircleAlert, Download, FileText, LoaderCircle, Plus, RefreshCw, Search } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.js';
import { OsApiError, osApi } from '../os/api.js';
import { useMissionFeed } from '../os/useMissionFeed.js';
import type { PageId } from '../pages.js';
import { Button, EmptyState, StateMessage } from '../components/ui.js';
import { RuntimePanel } from '../components/RuntimePanel.js';
import { formatDate } from './model.js';

type LibraryTab = 'artifacts' | 'memory';

interface MemoryEntry {
  id: string; scope: string; content: string; tags: string[]; provenance: string;
  createdAt: string; visibility?: string;
}

export function LibraryZone({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { t, lang } = useI18n();
  const feed = useMissionFeed();
  const [tab, setTab] = useState<LibraryTab>('artifacts');
  const [artifact, setArtifact] = useState<{ id: string; name: string; content: string } | null>(null);
  const [artifactBusy, setArtifactBusy] = useState<string | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoryNotice, setMemoryNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');

  const artifacts = feed.detail?.artifacts ?? [];

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setMemoryError(null);
    void (async () => {
      try {
        const rows = await osApi.memory(query.trim());
        if (!cancelled) setEntries(rows as unknown as MemoryEntry[]);
      } catch (err) {
        if (!cancelled) {
          setEntries([]);
          setMemoryError(err instanceof OsApiError ? err.message : t('op.library.loadError'));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [query, t]);

  useEffect(() => {
    if (!artifacts.length) { setArtifact(null); return; }
    let cancelled = false;
    setArtifactBusy(artifacts[0]!.id);
    setArtifactError(null);
    void osApi.artifact(artifacts[0]!.id)
      .then((value) => { if (!cancelled) setArtifact({ id: value.id, name: value.name, content: value.content }); })
      .catch((err: unknown) => { if (!cancelled) setArtifactError(err instanceof OsApiError ? err.message : t('op.library.loadError')); })
      .finally(() => { if (!cancelled) setArtifactBusy(null); });
    return () => { cancelled = true; };
  }, [artifacts[0]?.id, t]);

  const selectedMission = feed.detail;
  const memoryCount = entries?.length ?? 0;

  async function openArtifact(id: string) {
    setArtifactBusy(id);
    setArtifactError(null);
    try {
      const value = await osApi.artifact(id);
      setArtifact({ id: value.id, name: value.name, content: value.content });
    } catch (err) {
      setArtifactError(err instanceof OsApiError ? err.message : t('op.library.loadError'));
    } finally {
      setArtifactBusy(null);
    }
  }

  function downloadArtifact() {
    if (!artifact) return;
    const blob = new Blob([artifact.content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = artifact.name;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function addMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content.trim() || memoryBusy) return;
    setMemoryBusy(true);
    setMemoryError(null);
    setMemoryNotice(null);
    try {
      await osApi.addMemory({
        scope: 'workspace',
        content: content.trim(),
        tags: tags.split(/[,\u060C]/u).map((tag) => tag.trim()).filter(Boolean).slice(0, 20),
      });
      setContent('');
      setTags('');
      setMemoryNotice(t('op.library.memorySaved'));
      setEntries((await osApi.memory(query.trim())) as unknown as MemoryEntry[]);
    } catch (err) {
      setMemoryError(err instanceof OsApiError ? err.message : t('op.library.memoryError'));
    } finally {
      setMemoryBusy(false);
    }
  }

  const artifactItems = useMemo(() => artifacts.map((entry) => ({ ...entry, selected: artifact?.id === entry.id })), [artifacts, artifact?.id]);

  return <div className="op-zone op-library">
    <header className="op-zone-head">
      <div>
        <p className="op-eyebrow">{t('op.eyebrow')}</p>
        <h1>{t('op.library.title')}</h1>
        <p>{t('op.library.subtitle')}</p>
      </div>
      <div className="op-zone-state">
        <span><FileText size={14} aria-hidden="true" />{artifacts.length} {t('op.library.artifactsCount')}</span>
        <span><BookOpen size={14} aria-hidden="true" />{memoryCount} {t('op.library.memoryCount')}</span>
      </div>
    </header>

    <div className="op-library-bar">
      <label className="op-select"><span>{t('op.library.mission')}</span>
        <select value={feed.selectedId ?? ''} onChange={(event) => feed.selectMission(event.target.value)} aria-label={t('op.library.mission')}>
          {(feed.missions ?? []).map((mission) => <option key={mission.id} value={mission.id}>{mission.objective.slice(0, 52)}</option>)}
        </select>
      </label>
      <div className="op-tabs" role="tablist" aria-label={t('op.library.title')}>
        <button type="button" role="tab" aria-selected={tab === 'artifacts'} className={`op-tab${tab === 'artifacts' ? ' is-active' : ''}`} onClick={() => setTab('artifacts')}><FileText size={15} aria-hidden="true" />{t('op.library.artifacts')}</button>
        <button type="button" role="tab" aria-selected={tab === 'memory'} className={`op-tab${tab === 'memory' ? ' is-active' : ''}`} onClick={() => setTab('memory')}><BookOpen size={15} aria-hidden="true" />{t('op.library.memory')}</button>
      </div>
      <button type="button" className="icon-button" onClick={() => { void feed.refresh(); }} aria-label={t('op.refresh')} title={t('op.refresh')}><RefreshCw size={16} aria-hidden="true" /></button>
    </div>

    {tab === 'artifacts' && <><RuntimePanel missionId={selectedMission?.id} compact />
    <div className="op-library-grid">
      <section className="op-panel">
        <div className="op-panel-head"><div><h2>{t('op.library.artifacts')}</h2><p>{selectedMission?.objective ?? t('op.library.noMission')}</p></div></div>
        {feed.loading && !feed.detail && <StateMessage variant="loading" title={t('op.loading')} />}
        {!feed.loading && !feed.detail && <EmptyState icon={FileText} title={t('op.library.noMission')}><button type="button" className="button small" onClick={() => onNavigate('brief')}>{t('op.brief.title')}</button></EmptyState>}
        {feed.detail && artifacts.length === 0 && <EmptyState icon={FileText} title={t('op.library.noArtifacts')}><p>{t('op.library.noArtifactsBody')}</p></EmptyState>}
        {artifacts.length > 0 && <ul className="op-artifact-list">{artifactItems.map((entry) => <li key={entry.id} data-selected={entry.selected}>
          <FileText size={15} aria-hidden="true" />
          <span><strong>{entry.name}</strong><small>{entry.kind} · {formatDate(entry.createdAt ?? entry.created_at, lang)}</small></span>
          <button type="button" className="button small ghost" onClick={() => void openArtifact(entry.id)} disabled={artifactBusy === entry.id}>{artifactBusy === entry.id ? <LoaderCircle size={14} className="os-spin" aria-hidden="true" /> : t('op.library.open')}</button>
        </li>)}</ul>}
      </section>

      <section className="op-panel op-artifact-reader">
        <div className="op-panel-head"><div><h2>{artifact?.name ?? t('op.run.artifact')}</h2><p>{t('op.library.content')}</p></div>{artifact && <Button size="small" icon={Download} onClick={downloadArtifact}>{t('op.library.download')}</Button>}</div>
        {artifactBusy && <StateMessage variant="loading" title={t('op.loading')} />}
        {artifactError && <StateMessage variant="error" title={t('op.library.loadError')}><p>{artifactError}</p></StateMessage>}
        {!artifact && !artifactBusy && !artifactError && <p className="op-muted">{t('op.library.emptyArtifact')}</p>}
        {artifact && <pre dir="ltr">{artifact.content.slice(0, 24000)}</pre>}
      </section>
    </div></>}

    {tab === 'memory' && <div className="op-library-grid">
      <section className="op-panel">
        <div className="op-panel-head"><div><h2>{t('op.library.memory')}</h2><p>{t('op.library.subtitle')}</p></div></div>
        <form className="op-memory-form" onSubmit={(event) => void addMemory(event)}>
          <label className="op-field">{t('op.library.addMemory')}<textarea value={content} onChange={(event) => setContent(event.target.value)} rows={3} maxLength={4000} dir="auto" /></label>
          <label className="op-field">{t('op.library.memoryTags')}<input value={tags} onChange={(event) => setTags(event.target.value)} dir="auto" maxLength={300} /></label>
          <Button type="submit" variant="primary" size="small" icon={Plus} loading={memoryBusy} disabled={!content.trim()}>{t('op.library.saveMemory')}</Button>
          {memoryError && <p className="op-alert" role="alert"><CircleAlert size={14} aria-hidden="true" />{memoryError}</p>}
          {memoryNotice && <p className="op-notice" role="status">{memoryNotice}</p>}
        </form>
      </section>
      <section className="op-panel">
        <form className="op-search" role="search" onSubmit={(event) => { event.preventDefault(); }}>
          <Search size={15} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('op.library.searchPlaceholder')} aria-label={t('op.library.search')} />
        </form>
        {entries === null && <StateMessage variant="loading" title={t('op.loading')} />}
        {entries?.length === 0 && <EmptyState icon={BookOpen} title={t('op.library.noMemory')}><p>{t('op.library.noMemoryBody')}</p></EmptyState>}
        {entries && entries.length > 0 && <ul className="op-memory-list">{entries.map((entry) => <li key={entry.id}>
          <div className="op-memory-head"><span className="op-chip">{entry.scope}</span><small>{formatDate(entry.createdAt, lang)}</small></div>
          <p dir="auto">{entry.content}</p>
          <div className="op-memory-meta"><small>{t('op.library.provenance')}: <bdi>{entry.provenance}</bdi></small>{entry.tags?.length > 0 && <span>{entry.tags.map((tag) => <b key={tag}>#{tag}</b>)}</span>}</div>
        </li>)}</ul>}
      </section>
    </div>}
  </div>;
}
