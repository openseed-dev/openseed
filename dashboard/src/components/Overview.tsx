import {
  creatures, narrationEntries, narrationDisplayCount,
  allMoments, showMoments, sidebarOpen, selectCreature,
} from '../state';
import { useValue } from '../hooks';
import { NarrationEntry } from './NarrationEntry';
import { Moment } from './Moment';

function CreatureStrip() {
  const crMap = useValue(creatures);
  const names = Object.keys(crMap).sort();

  const dotColors: Record<string, string> = {
    running: 'bg-alive', sleeping: 'bg-dormant', stopped: 'bg-text-muted',
    error: 'bg-error', starting: 'bg-warn',
  };

  return (
    <div class="flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] tracking-[0.01em]">
      {names.map(n => {
        const c = crMap[n];
        return (
          <span
            key={n}
            class="inline-flex items-center gap-[5px] cursor-pointer text-text-dim hover:text-text-primary transition-colors duration-150"
            onClick={() => selectCreature(n)}
          >
            <span class={`w-[5px] h-[5px] rounded-full shrink-0 ${dotColors[c.status] || 'bg-text-muted'}`} />
            {n}
          </span>
        );
      })}
    </div>
  );
}

export function Overview() {
  const narrations = useValue(narrationEntries);
  const displayCount = useValue(narrationDisplayCount);
  const moments = useValue(allMoments);
  const momentsVisible = useValue(showMoments);
  const sbOpen = useValue(sidebarOpen);
  const crMap = useValue(creatures);

  const names = Object.keys(crMap).sort();
  const visible = narrations.slice(0, displayCount);
  const hasMore = narrations.length > displayCount;



  return (
    <>
      {/* Header — only when sidebar is closed */}
      {!sbOpen && (
        <div class="sticky top-0 z-20 bg-bg/95 backdrop-blur-sm border-b border-border-light">
          <div class="max-w-[760px] mx-auto px-10 py-4 flex items-center gap-4">
            <button
              class="w-7 h-7 rounded-md flex items-center justify-center transition-all duration-150 cursor-pointer shrink-0 text-text-faint hover:text-text-secondary hover:bg-border-light/50"
              onClick={() => { sidebarOpen.value = true; }}
              title="Show sidebar"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" class="w-[14px] h-[14px]">
                <rect x="1" y="2" width="14" height="12" rx="2" />
                <line x1="5.5" y1="2" x2="5.5" y2="14" />
              </svg>
            </button>

            <span class="font-serif text-[20px] font-medium text-text-primary tracking-[-0.02em] leading-none">openseed</span>

          <div class="ml-auto" />
          </div>
        </div>
      )}

      {/* Content */}
      <div class="py-8 px-10 max-w-[760px] mx-auto animate-[fade-in_0.3s_ease-out]">
        {/* Status strip */}
        <div class="pb-7 mb-8 border-b border-border-default">
          <CreatureStrip />
        </div>

        {/* Narration feed */}
        <div>
          {visible.length > 0
            ? visible.map((entry, i) => (
                <div key={entry.t + i} style={{ animationDelay: `${Math.min(i * 60, 300)}ms` }} class="animate-[narrate-in_0.4s_ease-out_both]">
                  <NarrationEntry entry={entry} />
                </div>
              ))
            : <div class="text-text-dim py-16 text-center text-[14px] font-serif italic tracking-[0.01em]">narrator is warming up…</div>
          }
        </div>

        {hasMore && (
          <div class="text-center py-5 pb-3">
            <button
              class="bg-transparent border-none text-text-dim p-0 cursor-pointer font-sans text-[11px] tracking-[0.03em] uppercase hover:text-text-secondary transition-colors"
              onClick={() => { narrationDisplayCount.value += 10; }}
            >
              read more
            </button>
          </div>
        )}

        {/* Moments toggle */}
        <div class="mt-8 pt-6 border-t border-border-default">
          <button
            class={`bg-transparent border-none text-text-dim p-0 cursor-pointer font-sans text-[11px] tracking-[0.03em] hover:text-text-secondary transition-colors ${momentsVisible ? 'text-text-secondary' : ''}`}
            onClick={() => { showMoments.value = !showMoments.value; }}
          >
            {momentsVisible ? '▾ hide raw events' : `▸ raw events (${moments.length})`}
          </button>
        </div>

        {momentsVisible && (
          <div class="mt-4 flex flex-col animate-[fade-in_0.2s_ease-out]">
            {moments.length > 0
              ? moments.map((ev, i) => <Moment key={(ev.t || '') + i} ev={ev} />)
              : <div class="text-text-dim py-6 text-center text-xs">no creature activity yet</div>
            }
          </div>
        )}
      </div>
    </>
  );
}
