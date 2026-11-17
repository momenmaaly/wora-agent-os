import { ArrowUpLeft, Building2, CircleHelp, Sparkles, Zap } from 'lucide-react';
import { NAV_ITEMS, type PageId } from '../pages.js';
import { useBillingStore } from '../store/useBillingStore.js';
import { WoraMark } from './WoraMark.js';

export function CompanySidebar({ page, onNavigate, onHelp }: { page: PageId; onNavigate: (page: PageId) => void; onHelp: () => void }) {
  const pro = useBillingStore((s) => s.plan === 'pro');
  const groups = [
    { id: 'workspace', label: 'مساحة العمل' },
    { id: 'management', label: 'الإدارة' },
  ] as const;

  function link(target: PageId) {
    return { href: `#${target}`, onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onNavigate(target);
    } };
  }

  return (
    <>
      <a className="sidebar-brand" aria-label="Wora — الاستقبال" {...link('overview')}><WoraMark /></a>
      <div className="sidebar-scroll hq-scroll">
        <div className="workspace-identity">
          <span className="workspace-symbol"><Building2 size={17} strokeWidth={1.7} aria-hidden="true" /></span>
          <div><strong>مساحة عمل <bdi>Wora</bdi></strong><small>المقر الرئيسي</small></div>
        </div>
        <nav aria-label="أقسام مساحة العمل" className="sidebar-navigation">
          {groups.map((group) => (
            <div className="nav-group" key={group.id}>
              <div className="nav-label">{group.label}</div>
              {NAV_ITEMS.filter((item) => item.group === group.id).map((item) => (
                <a key={item.id} {...link(item.id)} className="nav-link" aria-current={page === item.id ? 'page' : undefined}>
                  <item.icon size={18} strokeWidth={1.8} aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.id === 'studio' && <small className="pro-tag" dir="ltr">PRO</small>}
                </a>
              ))}
            </div>
          ))}
        </nav>
      </div>
      <div className="sidebar-bottom">
        <a className="upgrade-card" {...link('pricing')}>
          <span className="upgrade-top"><span className="upgrade-icon">{pro ? <Zap size={16} /> : <Sparkles size={16} />}</span><ArrowUpLeft size={15} aria-hidden="true" /></span>
          <strong>{pro ? 'خطتك: ' : 'استكشف '}<bdi>Wora Pro</bdi></strong>
          <small>{pro ? 'قارن بين الخطط المتاحة.' : 'مساحة أكبر لأفكار فريقك.'}</small>
        </a>
        <button className="nav-link sidebar-help" type="button" onClick={onHelp}><CircleHelp size={17} aria-hidden="true" /><span>دليل الاستخدام</span></button>
      </div>
    </>
  );
}
