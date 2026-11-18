import { ArrowUpLeft } from 'lucide-react';
import { SETTINGS_ITEMS, type SettingsPage } from '../pages.js';
import { WorkspaceSession } from './WorkspaceSession.js';

const descriptions = {
  models: 'اطّلع على النماذج المتاحة للفريق.',
  integrations: 'إدارة تجارب الربط مع أدوات العمل.',
  pricing: 'عرض الخطة الحالية وحدود مساحة العمل.',
};

export function WorkspaceSettings({ onNavigate }: { onNavigate: (page: SettingsPage) => void }) {
  return <section className="workspace-settings">
    <h1>الإعدادات</h1>
    <div className="panel settings-list">
      {SETTINGS_ITEMS.map((item) => <button key={item.id} type="button" onClick={() => onNavigate(item.id)}>
        <item.icon size={20} aria-hidden="true" /><span><strong>{item.label}</strong><small>{descriptions[item.id]}</small></span><ArrowUpLeft size={17} aria-hidden="true" />
      </button>)}
    </div>
    <WorkspaceSession />
  </section>;
}
