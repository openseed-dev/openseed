import { useEffect, useRef } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { Overview } from '@/components/Overview';
import { CreatureDetail } from '@/components/CreatureDetail';
import { ShareModal } from '@/components/ShareModal';
import { SettingsModal } from '@/components/SettingsModal';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useStore } from '@/state';

export function App() {
  const sseRef = useRef<EventSource | null>(null);
  const sel = useStore(s => s.selected);
  const sbOpen = useStore(s => s.sidebarOpen);
  const tab = useStore(s => s.selectedTab);
  const evLen = useStore(s => s.creatureEvents.length);
  const { refresh, loadNarration, loadRecentEvents, loadGenomes, loadGlobalBudget, handleSSEEvent } = useStore();

  const showSidebar = sel !== null || sbOpen;

  useEffect(() => {
    refresh()
      .then(() => Promise.all([loadRecentEvents(), loadNarration()]))
      .then(() => {});
    loadGenomes();
    loadGlobalBudget();
    const interval = setInterval(refresh, 2000);

    const sse = new EventSource('/api/events');
    sse.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      handleSSEEvent(ev);
    };
    sseRef.current = sse;

    return () => {
      clearInterval(interval);
      sse.close();
    };
  }, []);

  useEffect(() => {
    if (sel && tab === 'log') {
      requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
    }
  }, [evLen]);

  return (
    <TooltipProvider>
      <div className="flex min-h-screen bg-bg text-text-primary text-[13px] font-sans">
        {showSidebar && <Sidebar />}
        <div className="flex-1 min-w-0 flex flex-col">
          {sel === null ? <Overview /> : <CreatureDetail />}
        </div>
        <ShareModal />
        <SettingsModal />
      </div>
    </TooltipProvider>
  );
}
