import { describe, it, expect } from 'vitest';
import { stripImageData, IMAGE_PLACEHOLDER, containsImageData, estimateBase64Bytes } from './image-utils.js';

// =============================================================================
// stripImageData — recursive stripping of image data from nested structures
// =============================================================================

describe('stripImageData', () => {
  it('replaces data:image/ URI strings with placeholder', () => {
    const result = stripImageData('data:image/png;base64,iVBORw0KGgoAAAA');
    expect(result).toBe(IMAGE_PLACEHOLDER);
  });

  it('preserves normal strings', () => {
    expect(stripImageData('Hello world')).toBe('Hello world');
    expect(stripImageData('console.log("hi")')).toBe('console.log("hi")');
  });

  it('replaces long base64 strings (>1KB)', () => {
    const longB64 = 'A'.repeat(2000);
    expect(stripImageData(longB64)).toBe(IMAGE_PLACEHOLDER);
  });

  it('preserves short base64-like strings', () => {
    expect(stripImageData('SGVsbG8=')).toBe('SGVsbG8=');
  });

  it('truncates strings over 50KB safety valve', () => {
    const huge = 'x'.repeat(60000);
    const result = stripImageData(huge);
    expect(result).toContain('[truncated');
    expect(result.length).toBeLessThan(huge.length);
  });

  it('recursively strips nested objects', () => {
    const input = {
      outer: {
        inner: {
          image: 'data:image/jpeg;base64,' + 'A'.repeat(100),
          text: 'Keep this',
        },
      },
    };
    const result = stripImageData(input);
    expect(result.outer.inner.image).toBe(IMAGE_PLACEHOLDER);
    expect(result.outer.inner.text).toBe('Keep this');
  });

  it('strips images from arrays', () => {
    const input = [
      'data:image/png;base64,abc',
      'normal text',
      { nested: 'data:image/gif;base64,def' },
    ];
    const result = stripImageData(input);
    expect(result[0]).toBe(IMAGE_PLACEHOLDER);
    expect(result[1]).toBe('normal text');
    expect(result[2].nested).toBe(IMAGE_PLACEHOLDER);
  });

  it('handles null and undefined', () => {
    expect(stripImageData(null as any)).toBe(null);
    expect(stripImageData(undefined as any)).toBe(undefined);
  });

  it('handles primitive values', () => {
    expect(stripImageData(42 as any)).toBe(42);
    expect(stripImageData(true as any)).toBe(true);
  });

  it('handles Anthropic image blocks', () => {
    const input = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'iVBORw0KGgoAAAANSUh' + 'A'.repeat(1000),
      },
    };
    const result = stripImageData(input);
    expect(result.source.data).toBe(IMAGE_PLACEHOLDER);
    expect(result.source.media_type).toBe('image/png');
  });

  it('handles AI SDK image-data parts', () => {
    const input = { type: 'image-data', data: 'base64encodedstuff' };
    const result = stripImageData(input);
    expect(result.data).toBe(IMAGE_PLACEHOLDER);
  });

  it('strips image-url with data URIs', () => {
    const input = { type: 'image-url', url: 'data:image/png;base64,abc123' };
    const result = stripImageData(input);
    expect(result.url).toBe(IMAGE_PLACEHOLDER);
  });

  it('preserves short http image URLs', () => {
    const input = { type: 'image-url', url: 'https://example.com/img.png' };
    const result = stripImageData(input);
    expect(result.url).toBe('https://example.com/img.png');
  });

  it('strips raw base64 in nested structures', () => {
    const rawB64 = 'A'.repeat(2000);
    const input = { screenshot: rawB64, text: 'Hello' };
    const result = stripImageData(input);
    expect(result.screenshot).toBe(IMAGE_PLACEHOLDER);
    expect(result.text).toBe('Hello');
  });
});

// =============================================================================
// containsImageData — detect if structure has image data
// =============================================================================

describe('containsImageData', () => {
  it('detects data URI strings', () => {
    expect(containsImageData('data:image/png;base64,abc')).toBe(true);
  });

  it('detects long base64 strings', () => {
    expect(containsImageData('A'.repeat(2000))).toBe(true);
  });

  it('returns false for normal strings', () => {
    expect(containsImageData('hello world')).toBe(false);
  });

  it('detects images in nested objects', () => {
    expect(containsImageData({ a: { b: 'data:image/png;base64,abc' } })).toBe(true);
  });

  it('detects images in arrays', () => {
    expect(containsImageData(['normal', 'data:image/jpeg;base64,xyz'])).toBe(true);
  });

  it('returns false for null/undefined', () => {
    expect(containsImageData(null)).toBe(false);
    expect(containsImageData(undefined)).toBe(false);
  });
});

// =============================================================================
// estimateBase64Bytes — estimate decoded size
// =============================================================================

describe('estimateBase64Bytes', () => {
  it('estimates bytes for base64 string', () => {
    // Base64 encodes 3 bytes as 4 chars
    const b64 = 'AAAA'; // 4 chars → 3 bytes
    expect(estimateBase64Bytes(b64)).toBe(3);
  });

  it('handles longer strings', () => {
    const b64 = 'A'.repeat(400); // 400 chars → 300 bytes
    expect(estimateBase64Bytes(b64)).toBe(300);
  });

  it('handles padding', () => {
    const b64 = 'AA=='; // 4 chars with 2 padding → 1 byte
    expect(estimateBase64Bytes(b64)).toBeGreaterThan(0);
  });
});
