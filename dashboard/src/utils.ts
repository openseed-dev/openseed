import DOMPurify from 'dompurify';
import { marked } from 'marked';

export function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function ts(t?: string): string {
  return t ? t.slice(11, 19) : '';
}

export function timeAgo(iso: string): string {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 172800) return 'yesterday';
  return Math.floor(s / 86400) + 'd ago';
}

export function summarize(text: string, max: number): string {
  if (!text) return '...';
  const line = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))[0] || text.trim();
  return line.length > max ? line.slice(0, max) + '...' : line;
}

export function fmtCost(usd: number): string {
  return usd < 0.01 ? '<$0.01' : '$' + usd.toFixed(2);
}

let counter = 0;
export function uid(): string {
  return 'u' + (++counter) + Math.random().toString(36).slice(2, 6);
}

/** Sanitized markdown rendering — prevents XSS from creature-generated content. */
export function renderMarkdown(raw: string): string {
  try {
    const html = marked.parse(raw) as string;
    return DOMPurify.sanitize(html);
  } catch {
    return esc(raw);
  }
}
