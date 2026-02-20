import { useState, useRef, useEffect } from 'preact/hooks';
import {
  selected, selectedTab, creatures, creatureEvents, mindData,
  selectCreature, loadMind, refresh, creatureBudgets,
} from '../state';
import { useValue } from '../hooks';
import * as api from '../api';
import { esc } from '../utils';
import { Event } from './Event';
import { BudgetInfo } from './BudgetInfo';
import { MindContent } from './MindContent';

function MessageBar() {
  const [text, setText] = useState('');
  const name = selected.value;

  const send = async () => {
    if (!name || !text.trim()) return;
    await api.sendMessage(name, text.trim());
    setText('');
  };

  const paste = async () => {
    try {
      const clipboard = await navigator.clipboard.readText();
      setText(text + clipboard);
    } catch {
      alert('Clipboard access denied.');
    }
  };

  return (
    <div class="sticky bottom-0 bg-bg px-4 py-3 border-t border-border-light flex gap-2">
      <textarea
        class="flex-1 bg-white border border-[#d0d0d0] text-text-primary px-3 py-2 rounded font-sans text-[13px] resize-y min-h-[38px] max-h-[200px] focus:outline-none focus:border-accent"
        placeholder="Message to creature... (Cmd+Enter to send)"
        rows={2}
        value={text}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.metaKey) { e.preventDefault(); send(); }
        }}
      />
      <button
        class="bg-bg border border-[#d0d0d0] text-text-secondary px-2.5 py-2 rounded cursor-pointer text-[13px] hover:bg-[#f5f5f5]"
        onClick={paste} title="Paste from clipboard"
      >📋</button>
      <button
        class="bg-[#eff6ff] border border-accent text-accent px-4 py-2 rounded cursor-pointer font-sans text-[13px] hover:bg-[#dbeafe]"
        onClick={send}
      >Send</button>
    </div>
  );
}

export function CreatureDetail() {
  const name = useValue(selected)!;
  const crMap = useValue(creatures);
  const events = useValue(creatureEvents);
  const mind = useValue(mindData);
  const tab = useValue(selectedTab);
  const c = crMap[name];
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
      <div class="sticky top-0 z-20 bg-bg/95 backdrop-blur-sm px-4 py-3 border-b border-border-light flex items-center gap-3">
        <h2 class="text-sm font-semibold">{name}</h2>
        <div class="text-xs text-text-secondary">
          {c?.model && <><span class="text-text-muted text-[11px]">{c.model}</span> · </>}
          <span class="text-accent">{(c?.sha || '-').slice(0, 7)}</span> · {c?.status}{sr}
        </div>
        <BudgetInfo />
        <button class="bg-white border border-[#d0d0d0] text-text-secondary px-1.5 py-0.5 rounded text-[11px] cursor-pointer hover:bg-[#f5f5f5] hover:text-text-primary" onClick={() => api.creatureAction(name, 'wake')}>wake</button>
        <button class="bg-white border border-[#d0d0d0] text-text-secondary px-1.5 py-0.5 rounded text-[11px] cursor-pointer hover:bg-[#f5f5f5] hover:text-text-primary" onClick={() => { api.creatureAction(name, 'restart'); refresh(); }}>restart</button>
        <button class="bg-white border border-warn text-warn-light px-1.5 py-0.5 rounded text-[11px] cursor-pointer hover:bg-[#fffbf5]" onClick={() => { api.creatureAction(name, 'rebuild'); refresh(); }}>rebuild</button>
        <button class="bg-white border border-warn text-warn-light px-1.5 py-0.5 rounded text-[11px] cursor-pointer hover:bg-[#fffbf5]" onClick={() => {
          if (confirm(`Archive creature "${name}"? It will be stopped and moved to the archive.`)) {
            api.creatureAction(name, 'archive').then(() => { refresh(); selectCreature(null); });
          }
        }}>archive</button>
      </div>

      {/* Tab bar */}
      <div class="sticky top-[44px] z-[15] bg-bg border-b border-border-light px-4 flex">
        {tabIds.map(id => (
          <div
            key={id}
            class={`px-4 py-2 cursor-pointer text-xs border-b-2 ${tab === id ? 'text-accent border-accent' : 'text-text-muted border-transparent hover:text-text-secondary'}`}
            onClick={() => { selectedTab.value = id; }}
          >
            {tabLabels[id] || id}
          </div>
        ))}
        <div
          class="ml-auto px-3 py-2 cursor-pointer text-text-muted text-xs hover:text-text-secondary"
          onClick={() => loadMind().then(() => {})}
        >↻</div>
      </div>

      {/* Content */}
      <div class="p-4 flex-1">
        {tab === 'log' ? (
          <div class="flex flex-col gap-1 font-mono">
            {events.map((ev, i) => <Event key={(ev.t || '') + i} ev={ev} />)}
            <div ref={eventsEndRef} />
          </div>
        ) : mind ? (
          <MindContent mindData={mind} tabId={tab} />
        ) : (
          <div class="font-mono text-xs text-text-primary">Loading...</div>
        )}
      </div>

      {/* Message bar - only on log tab */}
      {tab === 'log' && <MessageBar />}
    </>
  );
}
