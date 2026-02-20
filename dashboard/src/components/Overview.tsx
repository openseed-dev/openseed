import { useStore } from '@/state';
import { NarrationEntry } from './NarrationEntry';
import { Moment } from './Moment';
import { Button } from '@/components/ui/button';
import { PanelLeft } from 'lucide-react';

function CreatureStrip() {
  const crMap = useStore(s => s.creatures);
  const selectCreature = useStore(s => s.selectCreature);
  const names = Object.keys(crMap).sort();

  const dotColors: Record<string, string> = {
    running: 'bg-alive', sleeping: 'bg-dormant', stopped: 'bg-text-muted',
    error: 'bg-error', starting: 'bg-warn',
  };

  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] tracking-[0.01em]">
      {names.map(n => {
        const c = crMap[n];
        return (
          <span
            key={n}
            className="inline-flex items-center gap-[5px] cursor-pointer text-text-dim hover:text-text-primary transition-colors duration-150"
            onClick={() => selectCreature(n)}
          >
            <span className={`w-[5px] h-[5px] rounded-full shrink-0 ${dotColors[c.status] || 'bg-text-muted'}`} />
            {n}
          </span>
        );
      })}
    </div>
  );
}

export function Overview() {
  const narrations = useStore(s => s.narrationEntries);
  const displayCount = useStore(s => s.narrationDisplayCount);
  const setNarrationDisplayCount = useStore(s => s.setNarrationDisplayCount);
  const moments = useStore(s => s.allMoments);
  const momentsVisible = useStore(s => s.showMoments);
  const setShowMoments = useStore(s => s.setShowMoments);
  const sbOpen = useStore(s => s.sidebarOpen);
  const setSidebarOpen = useStore(s => s.setSidebarOpen);

  const visible = narrations.slice(0, displayCount);
  const hasMore = narrations.length > displayCount;

  return (
    <>
      {/* Header — only when sidebar is closed */}
      {!sbOpen && (
        <div className="sticky top-0 z-20 bg-bg/95 backdrop-blur-sm border-b border-border-light">
          <div className="max-w-[760px] mx-auto px-10 py-4 flex items-center gap-4">
            <Button
              variant="ghost" size="icon-sm"
              className="text-text-faint hover:text-text-secondary"
              onClick={() => setSidebarOpen(true)}
              title="Show sidebar"
            >
              <PanelLeft className="size-[14px]" />
            </Button>
            <span className="font-serif text-[20px] font-medium text-text-primary tracking-[-0.02em] leading-none">openseed</span>
            <div className="ml-auto" />
          </div>
        </div>
      )}

      {/* Content */}
      <div className="py-8 px-10 max-w-[760px] mx-auto animate-[fade-in_0.3s_ease-out]">
        <div className="pb-7 mb-8 border-b border-border-default">
          <CreatureStrip />
        </div>

        <div>
          {visible.length > 0
            ? visible.map((entry, i) => (
                <div key={entry.t + i} style={{ animationDelay: `${Math.min(i * 60, 300)}ms` }} className="animate-[narrate-in_0.4s_ease-out_both]">
                  <NarrationEntry entry={entry} />
                </div>
              ))
            : <div className="text-text-dim py-16 text-center text-[14px] font-serif italic tracking-[0.01em]">narrator is warming up…</div>
          }
        </div>

        {hasMore && (
          <div className="text-center py-5 pb-3">
            <button
              className="bg-transparent border-none text-text-dim p-0 cursor-pointer font-sans text-[11px] tracking-[0.03em] uppercase hover:text-text-secondary transition-colors"
              onClick={() => setNarrationDisplayCount(displayCount + 10)}
            >
              read more
            </button>
          </div>
        )}

        <div className="mt-8 pt-6 border-t border-border-default">
          <button
            className={`bg-transparent border-none text-text-dim p-0 cursor-pointer font-sans text-[11px] tracking-[0.03em] hover:text-text-secondary transition-colors ${momentsVisible ? 'text-text-secondary' : ''}`}
            onClick={() => setShowMoments(!momentsVisible)}
          >
            {momentsVisible ? '▾ hide raw events' : `▸ raw events (${moments.length})`}
          </button>
        </div>

        {momentsVisible && (
          <div className="mt-4 flex flex-col animate-[fade-in_0.2s_ease-out]">
            {moments.length > 0
              ? moments.map((ev, i) => <Moment key={(ev.t || '') + i} ev={ev} />)
              : <div className="text-text-dim py-6 text-center text-xs">no creature activity yet</div>
            }
          </div>
        )}
      </div>
    </>
  );
}
