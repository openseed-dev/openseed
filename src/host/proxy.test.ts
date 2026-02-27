import { describe, it, expect } from 'vitest';
import {
  inferProvider,
  translateToolsToOpenAI,
  translateMessagesToOpenAI,
  translateResponseToAnthropic,
  translateMessagesToChat,
  translateToolsToChat,
  translateChatResponseToAnthropic,
  translateMessagesToGemini,
  translateToolsToGemini,
  translateGeminiResponseToAnthropic,
} from './proxy.js';

// =============================================================================
// inferProvider — model string → provider routing
// =============================================================================

describe('inferProvider', () => {
  it('routes slash-format models to OpenRouter regardless of prefix', () => {
    expect(inferProvider('openai/o3-mini')).toBe('openrouter');
    expect(inferProvider('anthropic/claude-3-5-sonnet')).toBe('openrouter');
    expect(inferProvider('openai/gpt-4o')).toBe('openrouter');
    expect(inferProvider('meta-llama/llama-3-70b')).toBe('openrouter');
    expect(inferProvider('google/gemini-2.0-flash')).toBe('openrouter');
  });

  it('routes claude- prefix to Anthropic', () => {
    expect(inferProvider('claude-3-5-sonnet-20241022')).toBe('anthropic');
    expect(inferProvider('claude-3-haiku-20240307')).toBe('anthropic');
    expect(inferProvider('claude-3-opus-20240229')).toBe('anthropic');
  });

  it('routes gpt- prefix to OpenAI', () => {
    expect(inferProvider('gpt-4o')).toBe('openai');
    expect(inferProvider('gpt-4o-mini')).toBe('openai');
    expect(inferProvider('gpt-4-turbo')).toBe('openai');
  });

  it('routes o3/o4 prefixes to OpenAI when no slash', () => {
    expect(inferProvider('o3-mini')).toBe('openai');
    expect(inferProvider('o4-preview')).toBe('openai');
    expect(inferProvider('o3')).toBe('openai');
  });

  it('routes gemini- prefix to Gemini', () => {
    expect(inferProvider('gemini-2.0-flash')).toBe('gemini');
    expect(inferProvider('gemini-1.5-pro')).toBe('gemini');
  });

  it('defaults to Anthropic for unknown models', () => {
    expect(inferProvider('some-unknown-model')).toBe('anthropic');
    expect(inferProvider('llama-70b')).toBe('anthropic');
  });

  // Regression: slash check must precede prefix checks
  it('slash check takes priority over prefix matching', () => {
    // "openai/o3-mini" has both a slash AND starts with a known prefix after the slash
    // Must route to OpenRouter, not OpenAI
    expect(inferProvider('openai/o3-mini')).toBe('openrouter');
    expect(inferProvider('anthropic/claude-3-5-sonnet')).toBe('openrouter');
    expect(inferProvider('google/gemini-2.0-flash')).toBe('openrouter');
  });
});

// =============================================================================
// translateToolsToOpenAI — Anthropic tool format → OpenAI Responses API format
// =============================================================================

describe('translateToolsToOpenAI', () => {
  it('translates Anthropic tools to OpenAI function format', () => {
    const anthropicTools = [
      {
        name: 'get_weather',
        description: 'Get current weather',
        input_schema: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    ];

    const result = translateToolsToOpenAI(anthropicTools);
    expect(result).toEqual([
      {
        type: 'function',
        name: 'get_weather',
        description: 'Get current weather',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    ]);
  });

  it('handles empty tools array', () => {
    expect(translateToolsToOpenAI([])).toEqual([]);
  });

  it('handles null/undefined tools', () => {
    expect(translateToolsToOpenAI(null as any)).toEqual([]);
    expect(translateToolsToOpenAI(undefined as any)).toEqual([]);
  });

  it('defaults description to empty string', () => {
    const tools = [{ name: 'test', input_schema: {} }];
    const result = translateToolsToOpenAI(tools);
    expect(result[0].description).toBe('');
  });

  it('defaults parameters to empty object when no input_schema', () => {
    const tools = [{ name: 'test', description: 'test' }];
    const result = translateToolsToOpenAI(tools);
    expect(result[0].parameters).toEqual({});
  });
});

// =============================================================================
// translateMessagesToOpenAI — Anthropic messages → OpenAI Responses API input
// =============================================================================

describe('translateMessagesToOpenAI', () => {
  it('translates simple user text message', () => {
    const { instructions, input } = translateMessagesToOpenAI(
      [{ role: 'user', content: 'Hello' }],
    );
    expect(instructions).toBeUndefined();
    expect(input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'Hello' }] },
    ]);
  });

  it('extracts system string as instructions', () => {
    const { instructions } = translateMessagesToOpenAI(
      [{ role: 'user', content: 'Hi' }],
      'You are a helpful assistant',
    );
    expect(instructions).toBe('You are a helpful assistant');
  });

  it('extracts system content blocks as instructions', () => {
    const { instructions } = translateMessagesToOpenAI(
      [{ role: 'user', content: 'Hi' }],
      [{ text: 'Line one' }, { text: 'Line two' }],
    );
    expect(instructions).toBe('Line one\nLine two');
  });

  it('translates assistant text messages', () => {
    const { input } = translateMessagesToOpenAI([
      { role: 'assistant', content: 'Hello back!' },
    ]);
    expect(input).toEqual([
      { role: 'assistant', content: [{ type: 'output_text', text: 'Hello back!' }] },
    ]);
  });

  it('translates tool_use blocks to function_call', () => {
    const { input } = translateMessagesToOpenAI([
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call_123', name: 'get_weather', input: { city: 'NYC' } },
        ],
      },
    ]);
    expect(input).toEqual([
      {
        type: 'function_call',
        call_id: 'call_123',
        name: 'get_weather',
        arguments: '{"city":"NYC"}',
      },
    ]);
  });

  it('translates tool_result blocks to function_call_output', () => {
    const { input } = translateMessagesToOpenAI([
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_123', content: 'Sunny, 72°F' },
        ],
      },
    ]);
    expect(input).toEqual([
      {
        type: 'function_call_output',
        call_id: 'call_123',
        output: 'Sunny, 72°F',
      },
    ]);
  });

  it('handles tool_result with array content blocks', () => {
    const { input } = translateMessagesToOpenAI([
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_456',
            content: [{ text: 'Line 1' }, { text: 'Line 2' }],
          },
        ],
      },
    ]);
    expect(input[0].output).toBe('Line 1\nLine 2');
  });

  it('handles mixed content blocks in user message', () => {
    const { input } = translateMessagesToOpenAI([
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: 'result1' },
          { type: 'text', text: 'Now do this' },
        ],
      },
    ]);
    expect(input).toHaveLength(2);
    expect(input[0].type).toBe('function_call_output');
    expect(input[1].role).toBe('user');
  });
});

// =============================================================================
// translateResponseToAnthropic — OpenAI Responses API → Anthropic format
// =============================================================================

describe('translateResponseToAnthropic', () => {
  it('translates text output to Anthropic response', () => {
    const openaiResp = {
      id: 'resp_123',
      output: [
        { type: 'message', content: [{ type: 'output_text', text: 'Hello!' }] },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    const result = translateResponseToAnthropic(openaiResp);
    expect(result.content).toEqual([{ type: 'text', text: 'Hello!' }]);
    expect(result.usage.input_tokens).toBe(10);
    expect(result.usage.output_tokens).toBe(5);
    expect(result.stop_reason).toBe('end_turn');
  });

  it('translates function_call to tool_use', () => {
    const openaiResp = {
      id: 'resp_456',
      output: [
        {
          type: 'function_call',
          call_id: 'call_789',
          name: 'get_weather',
          arguments: '{"city":"NYC"}',
        },
      ],
      usage: { input_tokens: 20, output_tokens: 10 },
    };
    const result = translateResponseToAnthropic(openaiResp);
    expect(result.content).toEqual([
      {
        type: 'tool_use',
        id: 'call_789',
        name: 'get_weather',
        input: { city: 'NYC' },
      },
    ]);
    expect(result.stop_reason).toBe('tool_use');
  });

  it('handles mixed text and function_call output', () => {
    const openaiResp = {
      id: 'resp_mix',
      output: [
        { type: 'message', content: [{ type: 'output_text', text: 'Let me check...' }] },
        { type: 'function_call', call_id: 'c1', name: 'search', arguments: '{"q":"test"}' },
      ],
      usage: { input_tokens: 30, output_tokens: 15 },
    };
    const result = translateResponseToAnthropic(openaiResp);
    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe('text');
    expect(result.content[1].type).toBe('tool_use');
    expect(result.stop_reason).toBe('tool_use');
  });
});

// =============================================================================
// Chat Completions API translation (OpenRouter path)
// =============================================================================

describe('translateMessagesToChat', () => {
  it('translates simple user/assistant messages', () => {
    const { systemMessage, chatMessages } = translateMessagesToChat([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]);
    expect(systemMessage).toBeUndefined();
    expect(chatMessages).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]);
  });

  it('extracts system prompt', () => {
    const { systemMessage } = translateMessagesToChat(
      [{ role: 'user', content: 'Hi' }],
      'Be helpful',
    );
    expect(systemMessage).toBe('Be helpful');
  });

  it('translates tool_use to assistant function calls', () => {
    const { chatMessages } = translateMessagesToChat([
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call_1', name: 'search', input: { q: 'test' } },
        ],
      },
    ]);
    expect(chatMessages[0].role).toBe('assistant');
    expect(chatMessages[0].tool_calls[0].function.name).toBe('search');
    expect(chatMessages[0].tool_calls[0].function.arguments).toBe('{"q":"test"}');
  });

  it('translates tool_result to tool role messages', () => {
    const { chatMessages } = translateMessagesToChat([
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: 'Found 42 results' },
        ],
      },
    ]);
    expect(chatMessages[0].role).toBe('tool');
    expect(chatMessages[0].content).toBe('Found 42 results');
    expect(chatMessages[0].tool_call_id).toBe('call_1');
  });
});

describe('translateToolsToChat', () => {
  it('translates Anthropic tools to Chat Completions format', () => {
    const tools = [
      { name: 'calc', description: 'Calculator', input_schema: { type: 'object', properties: { expr: { type: 'string' } } } },
    ];
    const result = translateToolsToChat(tools);
    expect(result[0].type).toBe('function');
    expect(result[0].function.name).toBe('calc');
    expect(result[0].function.description).toBe('Calculator');
  });
});

describe('translateChatResponseToAnthropic', () => {
  it('translates text response', () => {
    const chatResp = {
      id: 'chatcmpl-1',
      choices: [{ message: { content: 'Hello!', tool_calls: null }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
    const result = translateChatResponseToAnthropic(chatResp);
    expect(result.content).toEqual([{ type: 'text', text: 'Hello!' }]);
    expect(result.stop_reason).toBe('end_turn');
  });

  it('translates tool call response', () => {
    const chatResp = {
      id: 'chatcmpl-2',
      choices: [{
        message: {
          content: null,
          tool_calls: [
            { id: 'tc_1', function: { name: 'search', arguments: '{"q":"test"}' } },
          ],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 20, completion_tokens: 10 },
    };
    const result = translateChatResponseToAnthropic(chatResp);
    expect(result.content[0].type).toBe('tool_use');
    expect(result.content[0].name).toBe('search');
    expect(result.content[0].input).toEqual({ q: 'test' });
    expect(result.stop_reason).toBe('tool_use');
  });

  it('handles malformed JSON in tool arguments gracefully', () => {
    const chatResp = {
      id: 'chatcmpl-3',
      choices: [{
        message: {
          content: null,
          tool_calls: [
            { id: 'tc_bad', function: { name: 'search', arguments: 'not-json' } },
          ],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
    // Should not throw — should handle gracefully
    const result = translateChatResponseToAnthropic(chatResp);
    expect(result.content[0].type).toBe('tool_use');
    expect(result.content[0].name).toBe('search');
  });
});

// =============================================================================
// Gemini translation
// =============================================================================

describe('translateMessagesToGemini', () => {
  it('translates simple messages', () => {
    const { systemInstruction, contents } = translateMessagesToGemini(
      [{ role: 'user', content: 'Hello' }],
      'Be helpful',
    );
    expect(systemInstruction).toEqual({ parts: [{ text: 'Be helpful' }] });
    expect(contents).toEqual([
      { role: 'user', parts: [{ text: 'Hello' }] },
    ]);
  });

  it('translates tool_result to functionResponse', () => {
    const { contents } = translateMessagesToGemini([
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: '42' },
        ],
      },
    ]);
    expect(contents[0].role).toBe('user');
    expect(contents[0].parts[0].functionResponse).toBeDefined();
    expect(contents[0].parts[0].functionResponse.name).toBe('call_1');
  });

  it('translates tool_use to functionCall', () => {
    const { contents } = translateMessagesToGemini([
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call_1', name: 'calc', input: { expr: '2+2' } },
        ],
      },
    ]);
    expect(contents[0].role).toBe('model');
    expect(contents[0].parts[0].functionCall).toBeDefined();
    expect(contents[0].parts[0].functionCall.name).toBe('calc');
  });
});

describe('translateToolsToGemini', () => {
  it('wraps tools in functionDeclarations', () => {
    const tools = [
      { name: 'calc', description: 'Calculator', input_schema: { type: 'object' } },
    ];
    const result = translateToolsToGemini(tools);
    expect(result).toEqual([
      { functionDeclarations: [{ name: 'calc', description: 'Calculator', parameters: { type: 'object' } }] },
    ]);
  });
});

describe('translateGeminiResponseToAnthropic', () => {
  it('translates text response', () => {
    const geminiResp = {
      candidates: [{
        content: { parts: [{ text: 'Hello!' }] },
        finishReason: 'STOP',
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    };
    const result = translateGeminiResponseToAnthropic(geminiResp, 'gemini-2.0-flash');
    expect(result.content).toEqual([{ type: 'text', text: 'Hello!' }]);
    expect(result.stop_reason).toBe('end_turn');
  });

  it('translates function call response', () => {
    const geminiResp = {
      candidates: [{
        content: { parts: [{ functionCall: { name: 'calc', args: { expr: '2+2' } } }] },
        finishReason: 'STOP',
      }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 },
    };
    const result = translateGeminiResponseToAnthropic(geminiResp, 'gemini-2.0-flash');
    expect(result.content[0].type).toBe('tool_use');
    expect(result.content[0].name).toBe('calc');
    expect(result.content[0].input).toEqual({ expr: '2+2' });
    expect(result.stop_reason).toBe('tool_use');
  });
});
