import { useState } from 'preact/hooks';
import { ts, esc, summarize, uid } from '../utils';
import type { CreatureEvent } from '../types';

function Expandable({ summary, children }: { summary: any; children: any }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span class="cursor-pointer hover:underline" onClick={() => setOpen(!open)}>{summary}</span>
      {open && <div class="mt-1.5 p-2 bg-[#f5f5f5] rounded whitespace-pre-wrap break-all text-xs text-text-secondary">{children}</div>}
    </>
  );
}

export function Event({ ev, showCreature }: { ev: CreatureEvent; showCreature?: boolean }) {
  const t = ev.type;
  const cl = showCreature && ev.creature
    ? <span class="text-accent text-[11px] ml-1 font-bold">{ev.creature}</span>
    : null;

  // Border color mapping
  const borderColors: Record<string, string> = {
    'host.boot': 'border-l-text-muted',
    'host.spawn': 'border-l-accent',
    'host.promote': 'border-l-alive',
    'host.rollback': 'border-l-error',
    'creature.boot': 'border-l-accent',
    'creature.thought': 'border-l-text-muted',
    'creature.sleep': 'border-l-dormant',
    'creature.wake': 'border-l-[#0284c7]',
    'creature.message': 'border-l-accent',
    'creature.dream': ev.deep ? 'border-l-dream-deep' : 'border-l-dream',
    'creature.progress_check': 'border-l-warn',
    'creature.error': 'border-l-error',
    'creator.evaluation': 'border-l-alive',
    'creature.self_evaluation': 'border-l-alive',
    'budget.exceeded': 'border-l-error',
    'budget.reset': 'border-l-alive',
  };

  const bgColors: Record<string, string> = {
    'host.rollback': 'bg-red-50',
    'creature.boot': 'bg-[#f8faff]',
    'creature.thought': 'bg-bg',
    'creature.sleep': 'bg-[#f0f7ff]',
    'creature.wake': 'bg-[#f5fbff]',
    'creature.message': 'bg-[#eff6ff]',
    'creature.dream': ev.deep ? 'bg-[#f5f3ff]' : 'bg-[#faf5ff]',
    'creature.progress_check': 'bg-[#fffbf5]',
    'creature.error': 'bg-red-50',
    'creator.evaluation': 'bg-[#f0fdf4]',
    'creature.self_evaluation': 'bg-[#f0fdf4]',
    'budget.exceeded': 'bg-red-50',
    'budget.reset': 'bg-[#f0fdf4]',
  };

  let toolBorder = '';
  if (t === 'creature.tool_call') {
    const tn = ev.tool || 'bash';
    const br = tn === 'browser';
    toolBorder = br ? 'border-l-dream' : 'border-l-[#0284c7]';
    if (!ev.ok) toolBorder = 'border-l-error';
  }

  const border = t === 'creature.tool_call' ? toolBorder : (borderColors[t] || 'border-l-[#d0d0d0]');
  const bg = t === 'creature.tool_call'
    ? (ev.tool === 'browser' ? 'bg-[#faf5ff]' : (!ev.ok ? 'bg-red-50' : 'bg-[#f5fbff]'))
    : (bgColors[t] || 'bg-white');

  let body = null;

  if (t === 'creature.sleep') {
    body = (
      <>
        {cl}
        <span class="font-bold ml-2 text-dormant">sleep</span>
        <span class="text-text-muted text-[11px] ml-1.5">{ev.seconds || 30}s / {ev.actions || 0} actions</span>
        <Expandable summary={<span class="text-text-primary ml-1"> - {summarize(ev.text || '', 120)}</span>}>
          {ev.text || ''}
        </Expandable>
      </>
    );
  } else if (t === 'creature.wake') {
    body = <>{cl}<span class="font-bold ml-2 text-[#0284c7]">wake</span><span class="text-text-muted text-[11px] ml-1.5">{ev.source || ''}</span><span class="text-text-secondary ml-1"> - {ev.reason || ''}</span></>;
  } else if (t === 'creature.message') {
    body = <>{cl}<span class="font-bold ml-2 text-accent">{ev.source || 'user'}</span><span class="text-text-primary ml-1 whitespace-pre-wrap"> {ev.text || ''}</span></>;
  } else if (t === 'creature.tool_call') {
    const tn = ev.tool || 'bash';
    const br = tn === 'browser';
    const tc = `font-bold ${br ? 'text-dream' : 'text-[#0284c7]'} ${!ev.ok ? 'text-error' : ''}`;
    const cmdPreview = (ev.input || '').length > 80 ? (ev.input || '').slice(0, 80) + '...' : (ev.input || '');
    body = (
      <>
        {cl}
        <Expandable summary={
          <>
            <span class={tc + ' ml-2'}>▶ {tn}</span>
            <code class="text-text-primary bg-[#f0f0f0] px-1.5 py-0.5 rounded ml-1.5 font-mono text-xs"> {cmdPreview}</code>
          </>
        }>
          <div class="mb-1.5"><strong>input:</strong> {ev.input || ''}</div>
          {ev.output && <div class="border-t border-border-light pt-1.5"><strong>output:</strong>{'\n'}{ev.output}</div>}
        </Expandable>
        {ev.ok ? <span class="text-alive text-[11px] ml-1.5">ok</span> : <span class="text-error text-[11px] ml-1.5">fail</span>}
        <span class="text-text-muted text-[11px] ml-1.5">{ev.ms || 0}ms</span>
      </>
    );
  } else if (t === 'creature.thought') {
    body = <>{cl}<span class="font-bold ml-2 text-text-secondary">thought</span><span class="text-text-primary ml-1 whitespace-pre-wrap"> {ev.text || ''}</span></>;
  } else if (t === 'creature.dream') {
    const label = ev.deep ? 'deep sleep' : 'dream';
    body = (
      <>
        {cl}
        <span class={`font-bold ml-2 italic ${ev.deep ? 'text-dream-deep font-bold' : 'text-dream'}`}>{label}</span>
        <span class="text-text-muted text-[11px] ml-1.5">{ev.observations || 0} observations</span>
        <Expandable summary={<span class="text-text-primary ml-1"> - {summarize(ev.priority || '', 120)}</span>}>
          <strong>Priority:</strong> {ev.priority || ''}{'\n\n'}
          <strong>Reflection:</strong>{'\n'}{ev.reflection || ''}
        </Expandable>
      </>
    );
  } else if (t === 'creature.progress_check') {
    body = <>{cl}<span class="font-bold ml-2 text-warn-light">progress check</span><span class="text-text-muted text-[11px] ml-1.5">{ev.actions || 0} actions</span></>;
  } else if (t === 'creature.error') {
    const retryLabel = ev.retryIn ? 'retry in ' + (ev.retryIn / 1000) + 's' : 'recovering';
    body = (
      <>
        {cl}
        <span class="font-bold ml-2 text-error">error</span>
        {ev.retries && <span class="text-error text-[11px] ml-1.5">attempt #{ev.retries}</span>}
        <span class="text-text-muted text-[11px] ml-1.5">{retryLabel}</span>
        <span class="text-text-primary ml-1 whitespace-pre-wrap"> - {ev.error || 'unknown'}</span>
      </>
    );
  } else if (t === 'creator.evaluation' || t === 'creature.self_evaluation') {
    const changed = ev.changed || (ev.changes || []).length > 0;
    const label = changed ? 'self-evolved' : 'self-evaluated';
    body = (
      <>
        {cl}
        <span class="font-bold ml-2 text-alive">{label}</span>
        {changed && <span class="text-text-muted text-[11px] ml-1.5">code modified</span>}
        <Expandable summary={<span class="text-text-primary ml-1"> - {summarize(ev.reasoning || '', 120)}</span>}>
          <strong>Trigger:</strong> {ev.trigger || ''}{'\n\n'}
          <strong>Reasoning:</strong>{'\n'}{ev.reasoning || ''}
        </Expandable>
      </>
    );
  } else if (t === 'host.promote') {
    body = <>{cl}<span class="font-bold ml-2 text-alive">promoted</span><span class="text-text-secondary ml-1"><span class="text-accent">{(ev.sha || '').slice(0, 7)}</span></span></>;
  } else if (t === 'host.rollback') {
    body = <>{cl}<span class="font-bold ml-2 text-error">rollback</span><span class="text-text-secondary ml-1">{ev.reason || ''} <span class="text-accent">{(ev.from || '').slice(0, 7)}</span> → <span class="text-accent">{(ev.to || '').slice(0, 7)}</span></span></>;
  } else if (t === 'budget.exceeded') {
    body = <>{cl}<span class="font-bold ml-2 text-error">budget exceeded</span><span class="text-text-secondary ml-1">${(ev.daily_spent || ev.daily_spent_usd || 0).toFixed(2)} / ${(ev.daily_cap || ev.daily_cap_usd || 0).toFixed(2)} daily cap</span></>;
  } else if (t === 'budget.reset') {
    body = <>{cl}<span class="font-bold ml-2 text-alive">budget reset</span><span class="text-text-secondary ml-1">daily budget renewed</span></>;
  } else if (t === 'host.spawn') {
    body = <>{cl}<span class="font-bold ml-2 text-accent">spawn</span><span class="text-text-secondary ml-1">pid {ev.pid || '?'} <span class="text-accent">{(ev.sha || '').slice(0, 7)}</span></span></>;
  } else if (t === 'creature.boot') {
    body = <>{cl}<span class="font-bold ml-2 text-accent">creature boot</span><span class="text-text-secondary ml-1"><span class="text-accent">{(ev.sha || '').slice(0, 7)}</span></span></>;
  } else if (t === 'host.boot') {
    body = <>{cl}<span class="font-bold ml-2 text-text-muted">host boot</span></>;
  } else {
    const label = t.replace(/^creature\./, '').replace(/[._]/g, ' ');
    const fields = Object.keys(ev).filter(k => k !== 't' && k !== 'type' && k !== 'creature');
    if (fields.length) {
      const preview = fields.map(k => {
        const v = ev[k];
        return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? `${k}=${v}` : '';
      }).filter(Boolean).join(', ');
      body = (
        <>
          {cl}
          <span class="font-bold ml-2 text-text-muted">{label}</span>
          <Expandable summary={<span class="text-text-primary ml-1"> - {summarize(preview, 120)}</span>}>
            {fields.map(k => {
              const v = ev[k];
              const display = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
              return <div key={k}><strong>{k}:</strong> {display}</div>;
            })}
          </Expandable>
        </>
      );
    } else {
      body = <>{cl}<span class="font-bold ml-2 text-text-muted">{label}</span></>;
    }
  }

  return (
    <div class={`py-[7px] px-3 rounded border-l-[3px] ${border} ${bg} font-mono`}>
      <span class="text-text-muted text-[11px]">{ts(ev.t)}</span>
      {body}
    </div>
  );
}
