import { Menu, Moon, Search, Sun, Languages } from 'lucide-react';
import { useWoraStore } from '../store/useWoraStore.js';
import { CompanyStatusStrip } from './CompanyStatusStrip.js';
import { IconButton } from './ui.js';
import { WoraMark } from './WoraMark.js';
import { useI18n } from '../i18n/I18nContext.js';

export function CompanyHeader({ onMenu, onSearch, onHome }: { onMenu: () => void; onSearch: () => void; onHome: () => void }) {
  const theme = useWoraStore((s) => s.ui.theme);
  const toggleTheme = useWoraStore((s) => s.toggleTheme);
  const { t, lang, setLang } = useI18n();
  return <header className="topbar">
    <div className="topbar-start">
      <IconButton icon={Menu} label={t('app.openMenu')} onClick={onMenu} className="mobile-nav-button" aria-haspopup="dialog" />
      <a href="#home" className="mobile-brand" aria-label={`Wora — ${t('app.tagline')}`} onClick={(event) => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onHome(); } }}><WoraMark size={28} /></a>
    </div>
    <CompanyStatusStrip />
    <div className="topbar-actions">
      <button type="button" className="language-toggle" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} aria-label={t('app.language')} title={t('app.language')}>
        <Languages size={16} aria-hidden="true" /><span>{lang === 'ar' ? t('app.switchToEnglish') : t('app.switchToArabic')}</span>
      </button>
      <button type="button" className="search-trigger" aria-label={t('app.search')} aria-haspopup="dialog" aria-keyshortcuts="Control+k Meta+k" onClick={onSearch}>
        <Search size={17} strokeWidth={1.8} aria-hidden="true" /><span>{t('app.search')}</span><kbd dir="ltr">{t('app.searchShortcut')}</kbd>
      </button>
      <IconButton icon={theme === 'dark' ? Sun : Moon} label={theme === 'dark' ? t('app.lightMode') : t('app.darkMode')} onClick={toggleTheme} />
    </div>
  </header>;
}
