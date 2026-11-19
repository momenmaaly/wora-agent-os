import { useMemo } from 'react';
import { officeTasks } from '../office/work.js';
import { useWoraStore } from '../store/useWoraStore.js';

/** A compact operational context line; no productivity or synthetic metrics. */
export function CompanyStatusStrip() {
  const agents = useWoraStore((state) => state.agents);
  const workspaces = useWoraStore((state) => state.workspaces);
  const connected = useWoraStore((state) => state.connected);
  const serverMode = useWoraStore((state) => state.serverMode);
  const tasks = useMemo(() => officeTasks(workspaces), [workspaces]);
  const agentCount = useMemo(() => Object.keys(agents).length, [agents]);
  const mode = connected
    ? serverMode === 'server' ? 'خادم متصل' : serverMode === 'preview' ? 'معاينة محلية' : 'جلسة متصلة'
    : 'جلسة محلية';
  return <div className="company-status-strip" role="status" aria-label="Company operational status">
    <span className="company-operational"><span className="status-dot" />{mode}</span>
    <span><bdi>{agentCount}</bdi> وكلاء</span>
    <span><bdi>{tasks.length}</bdi> مهام مسجّلة</span>
    {serverMode === 'preview' && <span className="company-preview-note">لا يوجد مزوّد نماذج متصل</span>}
  </div>;
}
