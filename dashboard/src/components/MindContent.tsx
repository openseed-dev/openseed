import { useState, memo } from 'react';
import { esc, timeAgo, summarize, renderMarkdown } from '@/utils';
import type { MindData } from '@/types';

function JsonlEntry({ entry }: { entry: any }) {
  const [open, setOpen] = useState(false);
  const time = entry.t ? timeAgo(entry.t) : '';
  const rest = Object.keys(entry).filter(k => k !== 't');
  const summaryField = rest.find(k => typeof entry[k] === 'string' && entry[k].length > 10) || rest[0];
  const summary = summaryField ? summarize(String(entry[summaryField]), 120) : '...';

  return (
    <div className="mb-4 pb-4 border-b border-border-light last:border-b-0 last:mb-0 last:pb-0">
      <span className="text-text-muted text-[11px]">{time}</span>
      <span className="cursor-pointer hover:underline ml-1" onClick={() => setOpen(!open)}> {summary}</span>
      {open && (
        <div className="mt-1.5 p-2 bg-[#f5f5f5] rounded whitespace-pre-wrap break-all text-xs text-text-secondary">
          {rest.map(k => {
            const v = entry[k];
            const display = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
            return <div key={k}><strong>{k}:</strong> {display}</div>;
          })}
        </div>
      )}
    </div>
  );
}

export const MindContent = memo(function MindContent({ mindData, tabId }: { mindData: MindData; tabId: string }) {
  const tab = (mindData.tabs || []).find(t => t.id === tabId);
  const data = mindData.data?.[tabId];

  if (!tab) return <div className="p-4 font-mono text-xs text-text-primary leading-relaxed">Unknown tab.</div>;

  if (tab.type === 'jsonl') {
    const entries = Array.isArray(data) ? data : [];
    if (entries.length === 0) return <div className="p-4 font-mono text-xs text-text-primary leading-relaxed">No entries yet.</div>;
    return (
      <div className="p-4 font-mono text-xs text-text-primary leading-relaxed break-words">
        {entries.slice().reverse().map((e, i) => <JsonlEntry key={i} entry={e} />)}
      </div>
    );
  }

  if (tab.type === 'markdown') {
    const html = data ? renderMarkdown(data) : 'Empty.';
    return (
      <div
        className="p-4 font-mono text-xs text-text-primary leading-relaxed break-words [&_h1]:text-[15px] [&_h1]:my-4 [&_h2]:text-sm [&_h2]:my-3 [&_h3]:text-[13px] [&_h3]:my-2 [&_p]:my-1 [&_li]:my-0.5 [&_a]:text-accent-blue [&_code]:bg-[#f0f0f0] [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_pre]:bg-[#f5f5f5] [&_pre]:p-2 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre]:my-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:pl-5 [&_ul]:my-1.5 [&_ol]:pl-5 [&_ol]:my-1.5 [&_blockquote]:border-l-[3px] [&_blockquote]:border-[#d0d0d0] [&_blockquote]:pl-3 [&_blockquote]:text-text-secondary [&_blockquote]:my-2 [&_table]:border-collapse [&_table]:my-2 [&_th]:border [&_th]:border-border-light [&_th]:px-2 [&_th]:py-1 [&_th]:text-xs [&_th]:bg-[#f5f5f5] [&_th]:text-text-primary [&_td]:border [&_td]:border-border-light [&_td]:px-2 [&_td]:py-1 [&_td]:text-xs"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <div className="p-4 font-mono text-xs text-text-primary leading-relaxed break-words whitespace-pre-wrap">
      {data || 'Empty.'}
    </div>
  );
});
