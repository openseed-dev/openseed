import { timeAgo } from '@/utils';
import { useStore } from '@/state';
import type { CreatureEvent } from '@/types';

export function Moment({ ev }: { ev: CreatureEvent }) {
  const selectCreature = useStore(s => s.selectCreature);
  const t = ev.type;
  let label = '', lcls = '', content = null;

  if (t === 'creature.dream') {
    label = ev.deep ? 'deep sleep' : 'dream';
    lcls = ev.deep ? 'text-dream-deep font-semibold' : 'text-dream';
    content = (
      <>
        {ev.priority && <div className="text-[#5a5a5a] text-[12.5px] leading-[1.55] whitespace-pre-wrap break-words">{ev.priority}</div>}
        {ev.reflection && (
          <div className="text-[#8a8a8a] text-[11.5px] italic leading-[1.5] mt-1.5 pl-3 border-l border-border-default">
            {ev.reflection.length > 400 ? ev.reflection.slice(0, 400) + '...' : ev.reflection}
          </div>
        )}
        {ev.observations && <div className="text-text-dim text-[10px] mt-1 tracking-[0.02em]">{ev.observations} observations consolidated</div>}
      </>
    );
  } else if (t === 'creature.sleep') {
    label = 'sleeping'; lcls = 'text-dormant';
    const secs = ev.seconds || 0;
    const dur = secs >= 3600 ? Math.round(secs / 3600) + 'h' : Math.round(secs / 60) + 'm';
    content = (
      <>
        <div className="text-[#5a5a5a] text-[12.5px] leading-[1.55] whitespace-pre-wrap break-words">{ev.text || ''}</div>
        <div className="text-text-dim text-[10px] mt-1 tracking-[0.02em]">{ev.actions || 0} actions this cycle{secs ? ` · sleeping ${dur}` : ''}</div>
      </>
    );
  } else if (t === 'creature.self_evaluation' || t === 'creator.evaluation') {
    const changed = ev.changed || (ev.changes || []).length > 0;
    label = changed ? 'self-evolved' : 'self-evaluated';
    lcls = 'text-alive';
    content = <div className="text-[#5a5a5a] text-[12.5px] leading-[1.55] whitespace-pre-wrap break-words">{(ev.reasoning || '').slice(0, 400)}</div>;
  } else if (t === 'creature.thought') {
    label = 'thought'; lcls = 'text-text-dim';
    content = <div className="text-[#5a5a5a] text-[12.5px] leading-[1.55] whitespace-pre-wrap break-words">{ev.text || ''}</div>;
  } else if (t === 'creature.wake') {
    label = 'woke'; lcls = 'text-[#0284c7]';
    content = <div className="text-text-dim text-[10px] mt-1 tracking-[0.02em]">{ev.reason || ev.source || ''}</div>;
  } else if (t === 'budget.exceeded') {
    label = 'budget exceeded'; lcls = 'text-error';
    content = <div className="text-text-dim text-[10px] mt-1 tracking-[0.02em]">${(ev.daily_spent || 0).toFixed(2)} / ${(ev.daily_cap || 0).toFixed(2)} daily cap</div>;
  } else if (t === 'budget.reset') {
    label = 'budget reset'; lcls = 'text-alive';
  } else {
    return null;
  }

  return (
    <div className="py-3.5 border-b border-border-default animate-[moment-in_0.3s_ease-out] last:border-b-0">
      <div className="flex items-center gap-1.5 mb-1.5 text-[11px]">
        <span
          className="text-text-primary font-semibold cursor-pointer text-xs hover:underline"
          onClick={() => selectCreature(ev.creature || '')}
        >
          {ev.creature || ''}
        </span>
        <span className={`text-[11px] ${lcls}`}>{label}</span>
        <span className="text-text-faint ml-auto text-[10px] tabular-nums">{timeAgo(ev.t!)}</span>
      </div>
      {content}
    </div>
  );
}
