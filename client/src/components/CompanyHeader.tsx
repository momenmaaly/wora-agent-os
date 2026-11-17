import { ChevronLeft, Menu, Moon, Plus, Search, Sun } from 'lucide-react';
import { NAV_ITEMS, WORKSPACE_ICON, type PageId } from '../pages.js';
import { useWoraStore } from '../store/useWoraStore.js';
import { IconButton } from './ui.js';
import { WoraMark } from './WoraMark.js';

export function CompanyHeader({ page, onMenu, onSearch, onHire, onHome }: { page: PageId; onMenu: () => void; onSearch: () => void; onHire: () => void; onHome: () => void }) {
  const theme = useWoraStore((s) => s.ui.theme);
  const toggleTheme = useWoraStore((s) => s.toggleTheme);
  return (
    <header className="topbar">
      <div className="topbar-start">
        <IconButton icon={Menu} label="فتح القائمة" onClick={onMenu} className="mobile-nav-button" aria-haspopup="dialog" />
        <a href="#overview" className="mobile-brand" aria-label="Wora — الصفحة الرئيسية" onClick={(event) => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onHome(); } }}><WoraMark size={28} /></a>
        <div className="breadcrumbs">
          <span className="breadcrumbs-root"><WORKSPACE_ICON size={16} aria-hidden="true" />مساحة العمل</span>
          <ChevronLeft className="breadcrumbs-separator" size={14} aria-hidden="true" />
          <span>{NAV_ITEMS.find((item) => item.id === page)?.label}</span>
        </div>
      </div>
      <div className="topbar-actions">
        <button type="button" className="search-trigger" aria-label="البحث في مساحة العمل" aria-haspopup="dialog" aria-keyshortcuts="Control+k Meta+k" onClick={onSearch}>
          <Search size={17} strokeWidth={1.85} aria-hidden="true" /><span>بحث سريع...</span><kbd dir="ltr"><span>Ctrl</span> K</kbd>
        </button>
        <IconButton icon={theme === 'dark' ? Sun : Moon} label={theme === 'dark' ? 'تفعيل المظهر الفاتح' : 'تفعيل المظهر الداكن'} onClick={toggleTheme} />
        <button type="button" className="button primary topbar-hire" onClick={onHire}><Plus size={18} aria-hidden="true" /><span>وكيل جديد</span></button>
      </div>
    </header>
  );
}
