import { CircleHelp } from 'lucide-react';
import { isSettingsPage, NAV_ITEMS, type PageId } from '../pages.js';
import { CommandGlyph } from './CommandGlyph.js';

export function CompanySidebar({ page, onNavigate, onHelp }: { page: PageId; onNavigate: (page: PageId) => void; onHelp: () => void }) {
  function link(target: PageId) {
    return { href: `#${target}`, onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); onNavigate(target);
    } };
  }
  return <>
    <div className="sidebar-caption"><CommandGlyph kind="terminal" size={17} /><span dir="ltr">COMMAND MENU</span></div>
    <nav className="sidebar-navigation hq-scroll" aria-label="التنقل الرئيسي">
      {NAV_ITEMS.map((item, index) => <a key={item.id} {...link(item.id)} className={`nav-link${item.id === 'settings' ? ' nav-settings' : ''}`} aria-current={page === item.id || (item.id === 'settings' && isSettingsPage(page)) ? 'page' : undefined}>
        <item.icon size={18} strokeWidth={1.65} aria-hidden="true" /><span>{item.label}</span><small dir="ltr" aria-hidden="true">0{index + 1}</small>
      </a>)}
    </nav>
    <div className="sidebar-bottom"><button className="nav-link sidebar-help" type="button" onClick={onHelp}><CircleHelp size={17} aria-hidden="true" /><span>مساعدة</span></button><div className="sidebar-signature" dir="ltr" aria-hidden="true"><span>WORA.OS</span><span> // </span><span>01</span></div></div>
  </>;
}
