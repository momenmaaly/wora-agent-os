import { CircleHelp, Settings } from 'lucide-react';
import { isSettingsPage, NAV_ITEMS, SETTINGS_ITEMS, type PageId } from '../pages.js';
import { WoraMark } from './WoraMark.js';
import { useI18n } from '../i18n/I18nContext.js';

export function CompanySidebar({ page, onNavigate, onHelp }: { page: PageId; onNavigate: (page: PageId) => void; onHelp: () => void }) {
  const { t } = useI18n();
  function link(target: PageId) {
    return { href: `#${target}`, onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); onNavigate(target);
    } };
  }
  const secondary = SETTINGS_ITEMS.slice(1); // models / integrations / pricing — reachable, quiet, below the product areas
  return <>
    <a className="sidebar-brand" aria-label={`Wora — ${t('app.tagline')}`} {...link('home')}><WoraMark /></a>
    <nav className="sidebar-navigation hq-scroll" aria-label={t('nav.navigation')}>
      {NAV_ITEMS.map((item) => <a key={item.id} {...link(item.id)} className="nav-link" aria-current={page === item.id ? 'page' : undefined}>
        <item.icon size={18} strokeWidth={1.75} aria-hidden="true" /><span>{t(`nav.${item.id}`)}</span>
      </a>)}
      <div className="sidebar-separator" role="presentation" />
      {secondary.map((item) => <a key={item.id} {...link(item.id)} className="nav-link nav-secondary" aria-current={page === item.id ? 'page' : undefined}>
        <item.icon size={17} strokeWidth={1.75} aria-hidden="true" /><span>{t(`nav.${item.id}`)}</span>
      </a>)}
    </nav>
    <div className="sidebar-bottom">
      <a {...link('settings')} className="nav-link" aria-current={isSettingsPage(page) && page === 'settings' ? 'page' : undefined}>
        <Settings size={18} strokeWidth={1.75} aria-hidden="true" /><span>{t('nav.settings')}</span>
      </a>
      <button className="nav-link sidebar-help" type="button" onClick={onHelp}><CircleHelp size={17} aria-hidden="true" /><span>{t('app.help')}</span></button>
    </div>
  </>;
}
