import { BriefcaseBusiness, Menu, Moon, Search, Sun } from 'lucide-react';
import type { PageId } from '../pages.js';
import { useWoraStore } from '../store/useWoraStore.js';
import { IconButton } from './ui.js';
import { WoraMark } from './WoraMark.js';

export function CompanyHeader({ page, onMenu, onSearch, onHome, onDirector }: { page: PageId; onMenu: () => void; onSearch: () => void; onHome: () => void; onDirector: () => void }) {
  const theme = useWoraStore((s) => s.ui.theme);
  const toggleTheme = useWoraStore((s) => s.toggleTheme);
  return <header className="topbar">
    <div className="topbar-start">
      <IconButton icon={Menu} label="فتح القائمة" onClick={onMenu} className="mobile-nav-button" aria-haspopup="dialog" />
      <a href="#campus" className="mobile-brand" aria-label="Wora — ساحة العمل" onClick={(event) => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onHome(); } }}><WoraMark size={28} /></a>
      <span className="topbar-workspace">مساحة عمل <bdi>Wora</bdi></span>
    </div>
    <div className="topbar-actions">
      {page !== 'director' && <button type="button" className="icon-button mobile-director" aria-label="مكتب المدير" onClick={onDirector}><BriefcaseBusiness size={17} aria-hidden="true" /></button>}
      <button type="button" className="search-trigger" aria-label="البحث في مساحة العمل" aria-haspopup="dialog" aria-keyshortcuts="Control+k Meta+k" onClick={onSearch}>
        <Search size={17} strokeWidth={1.8} aria-hidden="true" /><span>ابحث في المساحة</span><kbd dir="ltr">Ctrl K</kbd>
      </button>
      <IconButton icon={theme === 'dark' ? Sun : Moon} label={theme === 'dark' ? 'تفعيل المظهر الفاتح' : 'تفعيل المظهر الداكن'} onClick={toggleTheme} />
    </div>
  </header>;
}
