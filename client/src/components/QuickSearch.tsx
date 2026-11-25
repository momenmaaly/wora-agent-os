import { useState } from 'react';
import { ArrowDown, ArrowUp, CornerDownLeft, Folder, Search, UsersRound, type LucideIcon } from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore.js';
import { useWoraStore } from '../store/useWoraStore.js';
import { OFFICE_ROOMS } from '../office/layout.js';
import { ROOM_DISPLAY } from '../office/presentation.js';
import { DIRECTOR_ROOM_ID } from '../office/work.js';
import { LEGACY_ITEMS, NAV_ITEMS, SETTINGS_ITEMS, type PageId } from '../pages.js';
import { useI18n } from '../i18n/I18nContext.js';
import { Dialog, EmptyState } from './ui.js';

type Result = { key: string; title: string; context: string; icon: LucideIcon; activate: () => void };

function normalize(text: string) {
  return text.trim().toLocaleLowerCase().replace(/[أإآٱ]/g, 'ا').replace(/[\u064B-\u065F\u0670]/g, '');
}

export function QuickSearch({ onClose, onNavigate, onAgent, onRoom }: { onClose: () => void; onNavigate: (page: PageId) => void; onAgent: (agentId: string) => void; onRoom: (roomId: string) => void }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const agents = useWoraStore((s) => s.agents);
  const projects = useProjectStore((s) => s.projects);
  const setProject = useProjectStore((s) => s.setActiveProject);
  const all: Result[] = [
    ...NAV_ITEMS.map((item) => ({ key: item.id, title: t(`nav.${item.id}`), context: t('quickSearch.page'), icon: item.icon, activate: () => onNavigate(item.id) })),
    ...SETTINGS_ITEMS.map((item) => ({ key: item.id, title: t(`nav.${item.id}`), context: t('quickSearch.settings'), icon: item.icon, activate: () => onNavigate(item.id) })),
    ...LEGACY_ITEMS.map((item) => ({ key: item.id, title: t(`nav.${item.id}`), context: t('quickSearch.page'), icon: item.icon, activate: () => onNavigate(item.id) })),
    ...OFFICE_ROOMS.filter((room) => room.id !== DIRECTOR_ROOM_ID).map((room) => ({ key: room.id, title: room.nameAr, context: `${t('quickSearch.department')} · ${ROOM_DISPLAY[room.id]!.label}`, icon: ROOM_DISPLAY[room.id]!.icon, activate: () => onRoom(room.id) })),
    ...Object.values(agents).map((agent) => ({ key: agent.id, title: agent.displayName, context: agent.profile.customRole, icon: UsersRound, activate: () => onAgent(agent.id) })),
    ...projects.map((project) => ({ key: project.id, title: project.name, context: t('quickSearch.project'), icon: Folder, activate: () => { setProject(project.id); onNavigate('projects'); } })),
  ];
  const keywords = normalize(query).split(/\s+/u).filter(Boolean);
  const results = keywords.length ? all.filter((result) => keywords.every((keyword) => normalize(`${result.title} ${result.context}`).includes(keyword))) : all.slice(0, NAV_ITEMS.length);
  const active = Math.min(cursor, Math.max(0, results.length - 1));
  const pick = (result: Result) => { onClose(); result.activate(); };

  return (
    <Dialog title={t('quickSearch.title')} icon={Search} onClose={onClose} variant="search"
      footer={<div className="search-hints" aria-hidden="true"><span><kbd><ArrowUp size={13} /></kbd> <kbd><ArrowDown size={13} /></kbd> {t('quickSearch.navigate')}</span><span><kbd>Enter</kbd> {t('quickSearch.open')}</span><span><kbd>Esc</kbd> {t('quickSearch.close')}</span></div>}>
      <div className="search-field">
        <Search size={19} aria-hidden="true" />
        <input data-initial-focus aria-label={t('quickSearch.aria')} placeholder={t('quickSearch.placeholder')} value={query}
          onChange={(event) => { setQuery(event.target.value); setCursor(0); }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || !results.length) return;
            if (event.key === 'Enter') { event.preventDefault(); pick(results[active]!); }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const next = (active + (event.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
              setCursor(next);
              event.currentTarget.closest('dialog')?.querySelector(`[data-result-index="${next}"]`)?.scrollIntoView({ block: 'nearest' });
            }
          }} />
      </div>
      <div className="quick-results hq-scroll">
        {results.length ? results.map((result, index) => (
          <button type="button" key={result.key} data-result-index={index} data-highlighted={index === active} onMouseEnter={() => setCursor(index)} onClick={() => pick(result)}>
            <result.icon size={17} aria-hidden="true" /><bdi>{result.title}</bdi><small>{result.context}</small><CornerDownLeft size={14} aria-hidden="true" />
          </button>
        )) : <EmptyState icon={Search} title={t('quickSearch.empty')}><p>{t('quickSearch.emptyBody')}</p></EmptyState>}
      </div>
    </Dialog>
  );
}
