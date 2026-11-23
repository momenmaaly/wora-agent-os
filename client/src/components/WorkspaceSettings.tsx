import { ArrowUpLeft } from 'lucide-react';
import { SETTINGS_ITEMS, type SettingsPage } from '../pages.js';
import { useI18n } from '../i18n/I18nContext.js';
import { WorkspaceSession } from './WorkspaceSession.js';

const descriptions: Record<'models' | 'integrations' | 'pricing', string> = {
  models: 'اطّلع على النماذج المتاحة وتبديل نموذج الوكيل.',
  integrations: 'إدارة تجارب الربط مع أدوات العمل.',
  pricing: 'عرض الخطة الحالية وحدود مساحة العمل (لا توجد بوابة دفع متصلة في هذا الإصدار).',
};

export function WorkspaceSettings({ onNavigate }: { onNavigate: (page: SettingsPage) => void }) {
  const { t } = useI18n();
  return <section className="workspace-settings">
    <h1>{t('nav.settings')}</h1>
    <div className="panel settings-list">
      {SETTINGS_ITEMS.filter((item) => item.id !== 'settings').map((item) => <button key={item.id} type="button" onClick={() => onNavigate(item.id)}>
        <item.icon size={20} aria-hidden="true" /><span><strong>{t(`nav.${item.id}`)}</strong><small>{descriptions[item.id as 'models' | 'integrations' | 'pricing']}</small></span><ArrowUpLeft size={17} aria-hidden="true" />
      </button>)}
    </div>
    <WorkspaceSession />
  </section>;
}
