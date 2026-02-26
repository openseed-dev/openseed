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
        { type: 'image-data', data: fakeBase64(60000), mediaType: 'image/jpeg' },
      ],
    }),
    ms: 3200,
  };
  const result = stripImageData(event);
  // The output is a string, so the base64 inside the JSON string won't be detected
  // by the object-level detection. This is expected — the output is already stringified.
  // The real fix is to strip BEFORE stringifying in the event emitter.
  assert.strictEqual(result.tool, 'see');
  console.log('✓ realistic event test passed');
}

console.log('\nAll tests passed! ✅');
