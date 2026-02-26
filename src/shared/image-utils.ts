/**
 * Image utilities for openseed.
 *
 * Images flow through the system as base64-encoded data in tool results
 * (e.g. from a `see` tool). These utilities ensure images are:
 * - Stripped from event logs and serialized conversation history
 * - Properly detected across provider formats (Anthropic, AI SDK, URLs)
 * - Safe for logging without exploding disk usage
 *
 * NOTE on conversation.jsonl: Stripping images from the conversation log
 * makes it lossy — replaying it won't reproduce the LLM's visual context.
 * This is intentional: the log exists for human inspection and debugging,
 * not for faithful replay. Image-bearing messages will contain placeholders
 * that indicate data was present but stripped.
 */

/** Placeholder inserted when stripping image data from logs */
export const IMAGE_PLACEHOLDER = '[image data stripped]';

/** Threshold above which any string is truncated as a safety valve (50KB) */
const LARGE_STRING_THRESHOLD = 50 * 1024;

/**
 * Recursively strip base64 image data from any object, replacing it
 * with a lightweight placeholder. Safe to call on events, messages,
 * tool results, or any serializable structure.
 *
 * Detection strategy (broad heuristic per Ross's guidance):
 * - Anthropic image blocks: { type: 'image', source: { type: 'base64', data: '...' } }
 * - AI SDK image parts:     { type: 'image-data', data: '...' }
 * - AI SDK image URLs:      { type: 'image-url', url: '...' } (data URIs and long URLs only)
 * - Broad catch-all:        any object with `type` containing 'image' and
 *                            a `data`/`url`/`source` field with a long string
 * - Raw base64 strings:     data URIs or strings >1KB of pure base64 chars
 * - Safety valve:            any string >50KB is truncated regardless of content
 */
export function stripImageData<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    // Strip data URIs (data:image/...)
    if (obj.startsWith('data:image/')) {
      return IMAGE_PLACEHOLDER as unknown as T;
    }
    // A base64 string over 1KB is almost certainly image data
    if (obj.length > 1024 && /^[A-Za-z0-9+/=]+$/.test(obj)) {
      return IMAGE_PLACEHOLDER as unknown as T;
    }
    // Safety valve: truncate any string over 50KB. This catches cases like
    // JSON-serialized image data inside tool output strings that we can't
    // structurally detect without parsing.
    if (obj.length > LARGE_STRING_THRESHOLD) {
      return `${obj.slice(0, 200)}... [truncated ${obj.length} chars]` as unknown as T;
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => stripImageData(item)) as unknown as T;
  }
  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    const typeStr = typeof record.type === 'string' ? record.type : '';

    // Anthropic image content block
    if (typeStr === 'image' && record.source &&
        typeof record.source === 'object' && (record.source as any).type === 'base64') {
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: (record.source as any).media_type || 'image/unknown',
          data: IMAGE_PLACEHOLDER,
        },
      } as unknown as T;
    }

    // AI SDK image-data part
    if (typeStr === 'image-data' && typeof record.data === 'string') {
      return {
        ...record,
        data: IMAGE_PLACEHOLDER,
      } as unknown as T;
    }

    // AI SDK image-url part — only strip data URIs and very long URLs
    // (which are likely signed URLs that leak credentials). Plain HTTP(S)
    // URLs to CDNs/hosts are harmless and useful for debugging.
    if (typeStr === 'image-url' && typeof record.url === 'string') {
      const url = record.url;
      if (url.startsWith('data:') || url.length > 2048) {
        return {
          ...record,
          url: IMAGE_PLACEHOLDER,
        } as unknown as T;
      }
      // Short HTTP(S) URLs are kept as-is for debugging
      return { ...record } as unknown as T;
    }

    // Broad heuristic: any object whose `type` contains 'image' and has a
    // `data` or `source` field that's a long string (>1KB). This catches
    // future provider formats without needing to enumerate every shape.
    if (typeStr.includes('image')) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(record)) {
        if ((key === 'data' || key === 'source' || key === 'url') &&
            typeof value === 'string' && value.length > 1024) {
          result[key] = IMAGE_PLACEHOLDER;
        } else {
          result[key] = stripImageData(value);
        }
      }
      return result as unknown as T;
    }

    // Recurse into all properties
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      result[key] = stripImageData(value);
    }
    return result as unknown as T;
  }
  return obj;
}

/**
 * Estimate the byte size of base64 image data.
 * Useful for checking against API limits before sending.
 */
export function estimateBase64Bytes(base64: string): number {
  // base64 encodes 3 bytes per 4 chars, minus padding
  const padding = (base64.match(/=+$/) || [''])[0].length;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Check if a value contains actual image payload data (useful for conditional logging).
 *
 * Unlike `stripImageData`, this returns `true` only when there's a substantial
 * image payload present — not just because an object has an image-related type.
 * For example, an `{ type: "image-reference", id: "img_abc" }` returns `false`
 * because it's just a reference with no payload to strip.
 *
 * Use this to decide whether to skip logging entirely. If you want to log but
 * with data removed, use `stripImageData` directly — it's safe on any input.
 */
export function containsImageData(obj: unknown): boolean {
  if (obj === null || obj === undefined) return false;
  if (typeof obj === 'string') {
    if (obj.startsWith('data:image/')) return true;
    if (obj.length > 1024 && /^[A-Za-z0-9+/=]+$/.test(obj)) return true;
    if (obj.length > LARGE_STRING_THRESHOLD) return true;
    return false;
  }
  if (Array.isArray(obj)) {
    return obj.some(item => containsImageData(item));
  }
  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    const typeStr = typeof record.type === 'string' ? record.type : '';

    // For image-typed objects, check that they have a substantial payload
    if (typeStr.includes('image')) {
      // Anthropic base64 image block
      if (record.source && typeof record.source === 'object' &&
          (record.source as any).type === 'base64' &&
          typeof (record.source as any).data === 'string' &&
          (record.source as any).data.length > 1024) {
        return true;
      }
      // AI SDK image-data
      if (typeof record.data === 'string' && record.data.length > 1024) {
        return true;
      }
      // AI SDK image-url with data URI or long signed URL
      if (typeof record.url === 'string' &&
          (record.url.startsWith('data:') || record.url.length > 2048)) {
        return true;
      }
      // type contains 'image' but no substantial payload — it's just a reference
      // Don't recurse here; if there's nested image data it'll be found below.
    }

    // Recurse into values
    return Object.values(record).some(v => containsImageData(v));
  }
  return false;
}
