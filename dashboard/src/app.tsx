import { useEffect, useRef } from 'preact/hooks';
import { Sidebar } from './components/Sidebar';
import { Overview } from './components/Overview';
import { CreatureDetail } from './components/CreatureDetail';
import { ShareModal } from './components/ShareModal';
import { useValue } from './hooks';
import {
  selected, sidebarOpen, refresh, loadNarration, loadRecentEvents,
  loadGenomes, loadGlobalBudget, handleSSEEvent, selectedTab, creatureEvents,
} from './state';

export function App() {
  const sseRef = useRef<EventSource | null>(null);
  const sel = useValue(selected);
  const sbOpen = useValue(sidebarOpen);
  const tab = useValue(selectedTab);
  const evLen = useValue(creatureEvents).length;

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
    <div class="flex min-h-screen bg-bg text-text-primary text-[13px] font-sans">
      {showSidebar && <Sidebar />}
      <div class="flex-1 min-w-0 flex flex-col">
        {sel === null ? <Overview /> : <CreatureDetail />}
      </div>
      <ShareModal />
    </div>
  );
}
