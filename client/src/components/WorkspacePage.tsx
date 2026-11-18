import { Component, Suspense, type ReactNode } from 'react';

class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return <section className="panel panel-pad field-stack">
      <div role="alert">
        <h1>تعذّر تحميل الصفحة</h1>
        <p className="subtle">أعد تحميل الصفحة لجلب أحدث نسخة، أو افتح صفحة أخرى من القائمة.</p>
      </div>
      <div><button type="button" className="button primary" onClick={() => window.location.reload()}>إعادة تحميل الصفحة</button></div>
    </section>;
  }
}

export function WorkspacePage({ children, loading = 'جارٍ تحميل الصفحة…' }: { children: ReactNode; loading?: string }) {
  return <PageErrorBoundary>
    <Suspense fallback={<div className="panel panel-pad subtle" role="status">{loading}</div>}>
      {children}
    </Suspense>
  </PageErrorBoundary>;
}
