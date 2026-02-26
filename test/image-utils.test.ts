import { stripImageData, containsImageData, estimateBase64Bytes, IMAGE_PLACEHOLDER } from '../src/shared/image-utils.js';
import assert from 'node:assert';

// Generate a fake base64 string of given length
function fakeBase64(len: number): string {
  return 'A'.repeat(len);
}

// Test: stripImageData on plain objects passes through
{
  const input = { type: 'creature.thought', text: 'hello', t: '2026-01-01' };
  const result = stripImageData(input);
  assert.deepStrictEqual(result, input);
  console.log('✓ plain objects pass through');
}

// Test: stripImageData strips Anthropic image blocks
{
  const input = {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: fakeBase64(50000) },
  };
  const result = stripImageData(input);
  assert.strictEqual(result.source.data, IMAGE_PLACEHOLDER);
  assert.strictEqual(result.source.media_type, 'image/png');
  console.log('✓ strips Anthropic image blocks');
}

// Test: stripImageData strips AI SDK image-data parts
{
  const input = { type: 'image-data', data: fakeBase64(50000), mediaType: 'image/jpeg' };
  const result = stripImageData(input);
  assert.strictEqual(result.data, IMAGE_PLACEHOLDER);
  assert.strictEqual(result.mediaType, 'image/jpeg');
  console.log('✓ strips AI SDK image-data parts');
}

// Test: stripImageData strips AI SDK image-url parts
{
  const input = { type: 'image-url', url: 'https://example.com/signed-image?token=secret123' };
  const result = stripImageData(input);
  assert.strictEqual(result.url, IMAGE_PLACEHOLDER);
  console.log('✓ strips AI SDK image-url parts');
}

// Test: stripImageData strips data URIs in strings
{
  const input = { url: 'data:image/png;base64,iVBORw0KGgo...' };
  const result = stripImageData(input);
  assert.strictEqual(result.url, IMAGE_PLACEHOLDER);
  console.log('✓ strips data URIs');
}

// Test: stripImageData strips long base64 strings
{
  const input = { data: fakeBase64(2000) };
  const result = stripImageData(input);
  assert.strictEqual(result.data, IMAGE_PLACEHOLDER);
  console.log('✓ strips long base64 strings');
}

// Test: stripImageData preserves short strings
{
  const input = { data: 'short string', id: 'abc123' };
  const result = stripImageData(input);
  assert.deepStrictEqual(result, input);
  console.log('✓ preserves short strings');
}

// Test: stripImageData handles nested arrays
{
  const input = {
    content: [
      { type: 'text', text: 'here is an image' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: fakeBase64(10000) } },
    ],
  };
  const result = stripImageData(input);
  assert.strictEqual(result.content[0].text, 'here is an image');
  assert.strictEqual((result.content[1] as any).source.data, IMAGE_PLACEHOLDER);
  console.log('✓ handles nested arrays');
}

// Test: stripImageData handles null/undefined
{
  assert.strictEqual(stripImageData(null), null);
  assert.strictEqual(stripImageData(undefined), undefined);
  console.log('✓ handles null/undefined');
}

// Test: broad heuristic catches unknown image types
{
  // Future provider format: type contains 'image', data is long
  const input = { type: 'custom-image-block', data: fakeBase64(5000), format: 'webp' };
  const result = stripImageData(input);
  assert.strictEqual(result.data, IMAGE_PLACEHOLDER);
  assert.strictEqual(result.format, 'webp');
  console.log('✓ broad heuristic catches unknown image types with long data');
}

// Test: broad heuristic catches image types with long source strings
{
  const input = { type: 'inline-image', source: fakeBase64(3000), alt: 'screenshot' };
  const result = stripImageData(input);
  assert.strictEqual(result.source, IMAGE_PLACEHOLDER);
  assert.strictEqual(result.alt, 'screenshot');
  console.log('✓ broad heuristic strips long source fields on image types');
}

// Test: broad heuristic ignores image types with short data (not actual image data)
{
  const input = { type: 'image-reference', data: 'img_abc123', id: '42' };
  const result = stripImageData(input);
  assert.strictEqual(result.data, 'img_abc123'); // short — kept
  console.log('✓ broad heuristic preserves short data on image types');
}

// Test: containsImageData detects images
{
  assert.strictEqual(containsImageData({ type: 'image', source: {} }), true);
  assert.strictEqual(containsImageData({ type: 'text', text: 'hello' }), false);
  assert.strictEqual(containsImageData({ nested: { type: 'image-data', data: 'x' } }), true);
  assert.strictEqual(containsImageData('data:image/png;base64,abc'), true);
  assert.strictEqual(containsImageData('just a normal string'), false);
  assert.strictEqual(containsImageData(fakeBase64(2000)), true);
  console.log('✓ containsImageData works');
}

// Test: containsImageData detects image-url
{
  assert.strictEqual(containsImageData({ type: 'image-url', url: 'https://example.com/img.png' }), true);
  console.log('✓ containsImageData detects image-url');
}

// Test: containsImageData catches broad heuristic types
{
  assert.strictEqual(containsImageData({ type: 'custom-image-v2', data: 'abc' }), true);
  console.log('✓ containsImageData catches types containing "image"');
}

// Test: estimateBase64Bytes
{
  // 4 base64 chars = 3 bytes
  assert.strictEqual(estimateBase64Bytes('AAAA'), 3);
  // With padding
  assert.strictEqual(estimateBase64Bytes('AA=='), 1);
  console.log('✓ estimateBase64Bytes works');
}

// Test: stripImageData on a realistic creature event
{
  const event = {
    t: '2026-02-26T10:00:00Z',
    type: 'creature.tool_call',
    tool: 'see',
    input: JSON.stringify({ url: 'https://example.com' }),
    ok: true,
    output: JSON.stringify({
      type: 'content',
      value: [
        { type: 'text', text: 'Screenshot of example.com (1024x768, 45KB)' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: fakeBase64(60000) } },
      ],
    }),
  };
  const result = stripImageData(event);
  // The output is a JSON string — stripImageData doesn't parse JSON strings,
  // so the stripping happens when the parsed content goes through separately
  assert.strictEqual(result.t, event.t);
  assert.strictEqual(result.tool, 'see');
  console.log('✓ realistic creature event preserved (JSON strings are opaque)');
}

// Test: stripImageData handles deeply nested image in message array
{
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What do you see?' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fakeBase64(80000) } },
      ],
    },
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'I see a cat.' }],
    },
  ];
  const result = stripImageData(messages);
  assert.strictEqual((result[0].content[1] as any).source.data, IMAGE_PLACEHOLDER);
  assert.strictEqual((result[0].content[0] as any).text, 'What do you see?');
  assert.strictEqual((result[1].content[0] as any).text, 'I see a cat.');
  console.log('✓ strips images in deeply nested message arrays');
}

console.log('\n✅ All image-utils tests passed');
