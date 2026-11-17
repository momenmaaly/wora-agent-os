import { Suspense } from 'react';
import { World } from './components/three/World.js';
import { AgentSidebar } from './components/AgentSidebar.js';
import { ChatPanel } from './components/ChatPanel.js';
import { SharedWorkspaceHUD } from './components/SharedWorkspaceHUD.js';
import { StatusBar } from './components/StatusBar.js';
import { useSocketLifecycle } from './hooks/useSocket.js';
import { useWoraStore } from './store/useWoraStore.js';

function WorldCanvas() {
  return (
    <div className="absolute inset-0">
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-full bg-background text-indigo-300 font-mono text-xs tracking-widest">
            INITIALIZING 3D WORKSPACE…
          </div>
        }
      >
        <World />
      </Suspense>
    </div>
  );
}

function SocketBridge() {
  useSocketLifecycle();
  return null;
}

export default function App() {
  const showSidebar = useWoraStore((s) => s.ui.showSidebar);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-background text-foreground">
      <SocketBridge />
      <AgentSidebar />
      <div
        className={`absolute inset-0 pt-11 transition-[padding] duration-300 ${
          showSidebar ? 'pl-64' : 'pl-0'
        }`}
      >
        <WorldCanvas />
      </div>
      <StatusBar />
      <SharedWorkspaceHUD />
      <ChatPanel />
    </div>
  );
}
