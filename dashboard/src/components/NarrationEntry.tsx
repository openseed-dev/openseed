import { timeAgo, renderMarkdown } from '@/utils';
import { useStore } from '@/state';
import type { NarrationEntry as NEntry } from '@/types';

const SHARE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-[11px] h-[11px]"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>`;

export function NarrationEntry({ entry }: { entry: NEntry }) {
  const selectCreature = useStore(s => s.selectCreature);
  const setShareData = useStore(s => s.setShareData);

  const html = renderMarkdown(entry.text);

  const mentioned = entry.creatures_mentioned || [];

  return (
    <div className="py-7 border-b border-border-default animate-[narrate-in_0.6s_ease-out] first:pt-0 last:border-b-0">
      <div className="flex items-center gap-2 mb-4 text-[11px] text-text-dim">
        <span className="text-narrator font-medium text-[11px] tracking-[0.04em] before:content-[''] before:inline-block before:w-1.5 before:h-1.5 before:bg-narrator before:rounded-full before:mr-1.5 before:align-[1px]">
          narrator
        </span>
        <span className="ml-auto tabular-nums">{timeAgo(entry.t)}</span>
      </div>
      <div
        className="text-[#2a2a2a] text-[16.5px] leading-[1.85] font-serif break-words font-normal tracking-[-0.005em] [&_p]:mb-3.5 [&_p:last-child]:mb-0 [&_strong]:text-text-primary [&_strong]:font-semibold [&_em]:text-text-secondary [&_code]:bg-[#edeae4] [&_code]:px-[5px] [&_code]:py-px [&_code]:rounded [&_code]:font-mono [&_code]:text-[13px]"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {mentioned.length > 0 && (
        <div className="mt-3 text-[10px] text-text-dim tracking-[0.02em] group">
          {mentioned.map((n, i) => (
            <span key={n}>
              {i > 0 && ', '}
              <span className="text-narrator cursor-pointer hover:underline" onClick={() => selectCreature(n)}>{n}</span>
              {entry.blocks?.[n] && (
                <button
                  className="bg-transparent border-none cursor-pointer p-px text-text-dim align-middle opacity-0 group-hover:opacity-100 transition-opacity hover:text-narrator"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShareData({ name: n, summary: entry.blocks![n], t: entry.t });
                  }}
                  title="Share"
                  dangerouslySetInnerHTML={{ __html: SHARE_SVG }}
                />
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
