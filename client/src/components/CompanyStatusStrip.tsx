import { useMemo } from 'react';
import { officeTasks } from '../office/work.js';
import { useWoraStore } from '../store/useWoraStore.js';

export function CompanyStatusStrip() {
  const agents = useWoraStore((state) => state.agents);
  const workspaces = useWoraStore((state) => state.workspaces);
  const connected = useWoraStore((state) => state.connected);
  const serverMode = useWoraStore((state) => state.serverMode);
  const tasks = useMemo(() => officeTasks(workspaces), [workspaces]);
  const list = useMemo(() => Object.values(agents), [agents]);
  const activeStates = new Set(['THINKING', 'REFINING', 'EXECUTING_TOOL', 'EXECUTING', 'RESPONDING']);
  const working = list.filter((agent) => activeStates.has(String(agent.lifecycleState)) || agent.status === 'BUSY').length;
  const blocked = list.filter((agent) => String(agent.lifecycleState) === 'ERROR').length;
  const waiting = tasks.filter((task) => task.status === 'open' && !task.payload?.directorResponse).length;
  const idle = list.filter((agent) => String(agent.lifecycleState) === 'IDLE' && agent.status !== 'OFFLINE').length;
  const mode = connected ? serverMode === 'server' ? 'Operational · server' : serverMode === 'preview' ? 'Preview mode' : 'Connected session' : 'Local session';
  return <div className="company-status-strip" role="status" aria-label="Company operational status">
    <span className="company-operational"><span className="status-dot" />{mode}</span>
    <span><bdi>{list.length}</bdi> AI employees</span>
    <span className="company-status-extra"><bdi>{working}</bdi> active</span>
    <span className="company-status-extra"><bdi>{idle}</bdi> idle</span>
    <span className="company-status-extra"><bdi>{waiting}</bdi> waiting</span>
    <span className="company-status-extra"><bdi>{blocked}</bdi> blocked</span>
  </div>;
}
