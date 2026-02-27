import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { lookupPricing, getPricing, CostTracker, _setLitellmPricing } from './costs.js';
import type { LiteLLMEntry } from './costs.js';

// =============================================================================
// lookupPricing — model string → cost per token
// =============================================================================

describe('lookupPricing', () => {
  const mockPricing: Record<string, LiteLLMEntry> = {
    'claude-3-5-sonnet-20241022': {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
    } as LiteLLMEntry,
    'gpt-4o': {
      input_cost_per_token: 0.000005,
      output_cost_per_token: 0.000015,
    } as LiteLLMEntry,
    'gemini/gemini-2.0-flash': {
      input_cost_per_token: 0.0000001,
      output_cost_per_token: 0.0000004,
    } as LiteLLMEntry,
    'openrouter/meta-llama/llama-3-70b': {
      input_cost_per_token: 0.0000008,
      output_cost_per_token: 0.0000008,
    } as LiteLLMEntry,
  };

  beforeEach(() => {
    _setLitellmPricing(mockPricing);
  });

  afterEach(() => {
    _setLitellmPricing(null);
  });

  it('finds exact model match', () => {
    const result = lookupPricing('claude-3-5-sonnet-20241022');
    expect(result).toEqual({ input: 0.000003, output: 0.000015 });
  });

  it('finds exact match for another model', () => {
    const result = lookupPricing('gpt-4o');
    expect(result).toEqual({ input: 0.000005, output: 0.000015 });
  });

  it('finds model via gemini/ prefix fallback', () => {
    const result = lookupPricing('gemini-2.0-flash');
    expect(result).toEqual({ input: 0.0000001, output: 0.0000004 });
  });

  it('returns null for unknown model', () => {
    const result = lookupPricing('totally-unknown-model-xyz');
    expect(result).toBeNull();
  });

  it('returns null when pricing data is not loaded', () => {
    _setLitellmPricing(null);
    expect(lookupPricing('gpt-4o')).toBeNull();
  });
});

// =============================================================================
// getPricing — public wrapper with fallback behavior
// =============================================================================

describe('getPricing', () => {
  beforeEach(() => {
    _setLitellmPricing({
      'gpt-4o': {
        input_cost_per_token: 0.000005,
        output_cost_per_token: 0.000015,
      } as LiteLLMEntry,
    });
  });

  afterEach(() => {
    _setLitellmPricing(null);
  });

  it('returns pricing for known model', () => {
    const result = getPricing('gpt-4o');
    expect(result.input).toBe(0.000005);
    expect(result.output).toBe(0.000015);
  });

  it('returns zero for unknown model', () => {
    const result = getPricing('unknown-model');
    expect(result).toEqual({ input: 0, output: 0 });
  });

  it('returns zero when pricing data not loaded', () => {
    _setLitellmPricing(null);
    const result = getPricing('gpt-4o');
    expect(result).toEqual({ input: 0, output: 0 });
  });
});

// =============================================================================
// CostTracker — usage recording and daily reset
// =============================================================================

describe('CostTracker', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    _setLitellmPricing({
      'test-model': {
        input_cost_per_token: 0.000001,
        output_cost_per_token: 0.000002,
      } as LiteLLMEntry,
    });
    // CostTracker constructor tries to read a file; it gracefully handles missing files
    tracker = new CostTracker();
  });

  afterEach(() => {
    _setLitellmPricing(null);
  });

  it('starts with zero for unknown creature', () => {
    const entry = tracker.get('nonexistent-creature');
    expect(entry.input_tokens).toBe(0);
    expect(entry.output_tokens).toBe(0);
    expect(entry.cost_usd).toBe(0);
    expect(entry.calls).toBe(0);
  });

  it('accumulates token counts', () => {
    tracker.record('test-creature', 100, 50, 'test-model');
    tracker.record('test-creature', 200, 100, 'test-model');
    const entry = tracker.get('test-creature');
    expect(entry.input_tokens).toBe(300);
    expect(entry.output_tokens).toBe(150);
    expect(entry.calls).toBe(2);
  });

  it('calculates cost using pricing data', () => {
    tracker.record('test-creature', 1000, 500, 'test-model');
    const entry = tracker.get('test-creature');
    // 1000 * 0.000001 + 500 * 0.000002 = 0.001 + 0.001 = 0.002
    expect(entry.cost_usd).toBeCloseTo(0.002, 6);
  });

  it('tracks daily cost', () => {
    tracker.record('test-creature', 1000, 500, 'test-model');
    const dailyCost = tracker.getCreatureDailyCost('test-creature');
    expect(dailyCost).toBeCloseTo(0.002, 6);
  });

  it('returns zero daily cost for unknown creature', () => {
    expect(tracker.getCreatureDailyCost('nonexistent')).toBe(0);
  });

  it('tracks multiple creatures independently', () => {
    tracker.record('creature-a', 100, 50, 'test-model');
    tracker.record('creature-b', 200, 100, 'test-model');
    expect(tracker.get('creature-a').input_tokens).toBe(100);
    expect(tracker.get('creature-b').input_tokens).toBe(200);
  });

  it('getAll returns all entries', () => {
    tracker.record('a', 100, 50, 'test-model');
    tracker.record('b', 200, 100, 'test-model');
    const all = tracker.getAll();
    expect(Object.keys(all)).toContain('a');
    expect(Object.keys(all)).toContain('b');
  });

  it('getTotal sums all costs', () => {
    tracker.record('a', 1000, 500, 'test-model');
    tracker.record('b', 1000, 500, 'test-model');
    // Each: 0.002, total: 0.004
    expect(tracker.getTotal()).toBeCloseTo(0.004, 6);
  });

  it('getCreatureCost returns total cost for a creature', () => {
    tracker.record('my-creature', 1000, 500, 'test-model');
    tracker.record('my-creature', 1000, 500, 'test-model');
    expect(tracker.getCreatureCost('my-creature')).toBeCloseTo(0.004, 6);
  });

  it('records zero cost when model is not specified', () => {
    tracker.record('creature', 1000, 500);
    const entry = tracker.get('creature');
    expect(entry.cost_usd).toBe(0);
    expect(entry.input_tokens).toBe(1000);
  });

  it('records zero cost for unknown model', () => {
    tracker.record('creature', 1000, 500, 'unknown-model-xyz');
    const entry = tracker.get('creature');
    expect(entry.cost_usd).toBe(0);
  });
});
