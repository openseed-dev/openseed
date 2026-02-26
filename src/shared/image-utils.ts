/**
 * Image utilities for openseed.
 *
 * Images flow through the system as base64-encoded data in tool results
 * (e.g. from a `see` tool). These utilities ensure images are:
 * - Stripped from event logs and serialized conversation history
 * - Properly resized before embedding in messages
 * - Translated correctly across provider APIs (Anthropic ↔ OpenAI)
 */

/** Placeholder inserted when stripping image data from logs */
export const IMAGE_PLACEHOLDER = '[image data stripped]';

/**
 * Recursively strip base64 image data from any object, replacing it
 * with a lightweight placeholder. Safe to call on events, messages,
 * tool results, or any serializable structure.
 *
 * Detects images by:
 * - Anthropic image blocks: { type: 'image', source: { type: 'base64', data: '...' } }
 * - AI SDK image parts:     { type: 'image-data', data: '...' }
 * - Raw base64 strings that look like data URIs or are >1KB of base64 chars
 */
export function stripImageData<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    // Strip data URIs (data:image/...) and suspiciously long base64 strings
    if (obj.startsWith('data:image/')) {
      return IMAGE_PLACEHOLDER as unknown as T;
    }
    // A base64 string over 1KB is almost certainly image data
    if (obj.length > 1024 && /^[A-Za-z0-9+/=]+$/.test(obj)) {
      return IMAGE_PLACEHOLDER as unknown as T;
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => stripImageData(item)) as unknown as T;
  }
  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>;

    // Anthropic image content block
    if (record.type === 'image' && record.source &&
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
    if (record.type === 'image-data' && typeof record.data === 'string') {
      return {
        ...record,
        data: IMAGE_PLACEHOLDER,
      } as unknown as T;
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
 * Check if a value contains image data (useful for conditional logging).
 */
export function containsImageData(obj: unknown): boolean {
  if (obj === null || obj === undefined) return false;
  if (typeof obj === 'string') {
    if (obj.startsWith('data:image/')) return true;
    if (obj.length > 1024 && /^[A-Za-z0-9+/=]+$/.test(obj)) return true;
    return false;
  }
  if (Array.isArray(obj)) {
    return obj.some(item => containsImageData(item));
  }
  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    if (record.type === 'image' || record.type === 'image-data') return true;
    return Object.values(record).some(v => containsImageData(v));
  }
  return false;
}
