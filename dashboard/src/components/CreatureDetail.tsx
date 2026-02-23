import { useState, useRef, useEffect } from 'react';
import { useStore } from '@/state';
import * as api from '@/api';
import { Event } from './Event';
import { BudgetInfo } from './BudgetInfo';
import { MindContent } from './MindContent';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RefreshCw } from 'lucide-react';

function MessageBar() {
  const [text, setText] = useState('');
  const name = useStore(s => s.selected);

  const send = async () => {
    if (!name || !text.trim()) return;
    await api.sendMessage(name, text.trim());
    setText('');
  };

  return (
    <div className="sticky bottom-0 bg-bg px-4 py-3 border-t border-border-light flex gap-2">
      <textarea
        className="flex-1 bg-white border border-input text-text-primary px-3 py-2 rounded font-sans text-[13px] resize-y min-h-[38px] max-h-[200px] focus:outline-none focus:border-ring"
        placeholder="Message to creature... (Cmd+Enter to send)"
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.metaKey) { e.preventDefault(); send(); }
        }}
      />
      <button className="bg-[#eff6ff] border border-accent-blue text-accent-blue px-4 py-2 rounded cursor-pointer font-sans text-[13px] hover:bg-[#dbeafe] transition-colors" onClick={send}>Send</button>
    </div>
  );
}

export function CreatureDetail() {
  const name = useStore(s => s.selected)!;
  const c = useStore(s => s.creatures[name]);
  const events = useStore(s => s.creatureEvents);
  const mind = useStore(s => s.mindData);
  const tab = useStore(s => s.selectedTab);
  const setSelectedTab = useStore(s => s.setSelectedTab);
  const selectCreature = useStore(s => s.selectCreature);
  const loadMind = useStore(s => s.loadMind);
  const refresh = useStore(s => s.refresh);
  const degraded = useStore(s => s.health.status !== 'healthy');
  const eventsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (tab === 'log') {
      eventsEndRef.current?.scrollIntoView();
    }
  }, [events.length, tab]);

  const genomeTabs = mind?.tabs || [];
  const tabIds = ['log', ...genomeTabs.map(t => t.id)];
  const tabLabels: Record<string, string> = { log: 'log' };
  genomeTabs.forEach(t => { tabLabels[t.id] = t.label || t.id; });

  const sr = c?.sleepReason === 'budget' ? ' (budget cap)' : '';

  return (
    <>
      {/* Header */}
      <div className="sticky top-0 z-20 bg-bg/95 backdrop-blur-sm px-4 py-3 border-b border-border-light flex items-center gap-3">
        <h2 className="text-sm font-semibold">{name}</h2>
        <div className="text-xs text-text-secondary">
          {c?.model && <><span className="text-text-muted text-[11px]">{c.model}</span> · </>}
          {c?.status}{sr}
          {c?.janeeVersion && <> · <span className="text-text-muted text-[11px]">janee {c.janeeVersion}</span></>}
        </div>
        <BudgetInfo />
        <button className="bg-white border border-[#d0d0d0] text-text-secondary px-1.5 py-0.5 rounded text-[11px] cursor-pointer hover:bg-[#f5f5f5] hover:text-text-primary transition-colors" onClick={() => api.creatureAction(name, 'wake')}>wake</button>
        <button className="bg-white border border-[#d0d0d0] text-text-secondary px-1.5 py-0.5 rounded text-[11px] cursor-pointer hover:bg-[#f5f5f5] hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed" disabled={degraded} title={degraded ? 'Orchestrator degraded' : undefined} onClick={() => { api.creatureAction(name, 'restart'); refresh(); }}>restart</button>
        <button className="bg-white border border-warn text-warn-light px-1.5 py-0.5 rounded text-[11px] cursor-pointer hover:bg-[#fffbf5] transition-colors disabled:opacity-40 disabled:cursor-not-allowed" disabled={degraded} title={degraded ? 'Orchestrator degraded' : undefined} onClick={() => { api.creatureAction(name, 'rebuild'); refresh(); }}>rebuild</button>
        <button className="bg-white border border-warn text-warn-light px-1.5 py-0.5 rounded text-[11px] cursor-pointer hover:bg-[#fffbf5] transition-colors" onClick={() => {
          if (confirm(`Archive creature "${name}"? It will be stopped and moved to the archive.`)) {
            api.creatureAction(name, 'archive').then(() => { refresh(); selectCreature(null); });
          }
        }}>archive</button>
      </div>

      {/* Tab bar */}
      <div className="sticky top-[44px] z-[15] bg-bg border-b border-border-light px-4">
        <Tabs value={tab} onValueChange={setSelectedTab}>
          <div className="flex items-center">
            <TabsList className="bg-transparent h-auto p-0 gap-0">
              {tabIds.map(id => (
                <TabsTrigger
                  key={id}
                  value={id}
                  className="rounded-none border-0 border-b-2 border-transparent data-[state=active]:border-accent-blue data-[state=active]:text-accent-blue data-[state=active]:shadow-none data-[state=active]:bg-transparent dark:data-[state=active]:bg-transparent dark:data-[state=active]:border-transparent dark:data-[state=active]:border-b-accent-blue bg-transparent px-4 py-2 text-xs text-text-muted hover:text-text-secondary"
                >
                  {tabLabels[id] || id}
                </TabsTrigger>
              ))}
            </TabsList>
            <button className="ml-auto px-3 py-2 cursor-pointer text-text-muted text-xs hover:text-text-secondary bg-transparent border-none transition-colors" onClick={() => loadMind()}>
              <RefreshCw className="size-3" />
            </button>
          </div>
        </Tabs>
      </div>

      {/* Content */}
      <div className="p-4 flex-1">
        {tab === 'log' ? (
          <div className="flex flex-col gap-1 font-mono">
            {events.map((ev, i) => <Event key={(ev.t || '') + i} ev={ev} />)}
            <div ref={eventsEndRef} />
          </div>
        ) : mind ? (
          <MindContent mindData={mind} tabId={tab} />
        ) : (
          <div className="font-mono text-xs text-text-primary">Loading...</div>
        )}
      </div>

      {tab === 'log' && <MessageBar />}
    </>
  );
}
