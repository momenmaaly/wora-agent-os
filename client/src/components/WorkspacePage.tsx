import { Component, Suspense, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18nContext.js';

class PageErrorBoundary extends Component<{ children: ReactNode; title: string; body: string; action: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return <section className="panel panel-pad field-stack">
      <div role="alert">
        <h1>{this.props.title}</h1>
        <p className="subtle">{this.props.body}</p>
      </div>
      <div><button type="button" className="button primary" onClick={() => window.location.reload()}>{this.props.action}</button></div>
    </section>;
  }
}

export function WorkspacePage({ children, loading }: { children: ReactNode; loading?: string }) {
  const { t } = useI18n();
  return <PageErrorBoundary title={t('app.pageLoadError')} body={t('app.pageLoadBody')} action={t('app.reload')}>
    <Suspense fallback={<div className="panel panel-pad subtle" role="status">{loading ?? t('app.loading')}</div>}>
      {children}
    </Suspense>
  </PageErrorBoundary>;
}
