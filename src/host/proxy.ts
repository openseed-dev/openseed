import type {
  IncomingMessage,
  ServerResponse,
} from 'node:http';

import type { CostTracker } from './costs.js';
import { sendErrorResponse } from './http-error-handler.js';


// --- Image block translation helpers ---

function anthropicImageToDataUrl(source: any): string | null {
  if (source?.type === 'base64' && source.data && source.media_type) {
    return `data:${source.media_type};base64,${source.data}`;
  }
  if (source?.type === 'url' && source.url) {
    return source.url;
  }
  return null;
}

export interface BudgetCheckResult {
  allowed: boolean;
  action: 'sleep' | 'warn' | 'off';
  dailyCap: number;
  dailySpent: number;
}

export type BudgetChecker = (creatureName: string) => BudgetCheckResult;

// Anthropic -> OpenAI Responses API translation proxy.
// Creatures always speak Anthropic format. The proxy detects the model
// and routes to the right upstream, translating if needed.

export type Provider = 'anthropic' | 'openai' | 'openrouter' | 'gemini';

export function inferProvider(model: string): Provider {
  // Slash check first: org/model format (e.g. "openai/o3-mini") always routes via OpenRouter
  if (model.includes('/')) return 'openrouter';
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('gpt-') || model.startsWith('o3') || model.startsWith('o4')) return 'openai';
  if (model.startsWith('gemini-')) return 'gemini';
  return 'anthropic'; // safe default
}

// --- Anthropic-to-OpenAI translation ---

export function translateToolsToOpenAI(tools: any[]): any[] {
  if (!tools?.length) return [];
  return tools.map(t => ({
    type: 'function' as const,
    name: t.name,
    description: t.description || '',
    parameters: t.input_schema || {},
  }));
}

export function translateMessagesToOpenAI(messages: any[], system?: string | any[]): { instructions: string | undefined; input: any[] } {
  // Anthropic sends system as either a string or array of content blocks
  let instructions: string | undefined;
  if (Array.isArray(system)) {
    instructions = system.map((b: any) => b.text || '').filter(Boolean).join('\n');
  } else {
    instructions = system || undefined;
  }

  const input: any[] = [];

  for (const msg of messages) {
    const content = msg.content;

    if (msg.role === 'user') {
      if (typeof content === 'string') {
        input.push({ role: 'user', content: [{ type: 'input_text', text: content }] });
      } else if (Array.isArray(content)) {
        // Could contain tool_result blocks mixed with text
        for (const block of content) {
          if (block.type === 'tool_result') {
            const outputText = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map((b: any) => b.text || '').join('\n')
                : JSON.stringify(block.content);
            input.push({
              type: 'function_call_output',
              call_id: block.tool_use_id,
              output: outputText,
            });
          } else if (block.type === 'text') {
            input.push({ role: 'user', content: [{ type: 'input_text', text: block.text }] });
          } else if (block.type === 'image') {
            const url = anthropicImageToDataUrl(block.source);
            if (url) {
              input.push({ role: 'user', content: [{ type: 'input_image', image_url: url }] });
            }
          }
        }
      }
    } else if (msg.role === 'assistant') {
      if (typeof content === 'string') {
        input.push({ role: 'assistant', content: [{ type: 'output_text', text: content }] });
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text') {
            input.push({ role: 'assistant', content: [{ type: 'output_text', text: block.text }] });
          } else if (block.type === 'tool_use') {
            input.push({
              type: 'function_call',
              call_id: block.id,
              name: block.name,
              arguments: JSON.stringify(block.input),
            });
          }
        }
      }
    }
  }

  return { instructions, input };
}

export function translateResponseToAnthropic(openaiResp: any): any {
  const content: any[] = [];
  let hasToolUse = false;

  for (const item of openaiResp.output || []) {
    if (item.type === 'message') {
      for (const part of item.content || []) {
        if (part.type === 'output_text') {
          content.push({ type: 'text', text: part.text });
        }
      }
    } else if (item.type === 'function_call') {
      hasToolUse = true;
      let parsedInput: any;
      try {
        parsedInput = JSON.parse(item.arguments);
      } catch {
        parsedInput = {};
      }
      content.push({
        type: 'tool_use',
        id: item.call_id,
        name: item.name,
        input: parsedInput,
      });
    }
    // Skip 'reasoning' items; creatures don't know about them
  }

  const stopReason = hasToolUse ? 'tool_use' : 'end_turn';

  return {
    id: openaiResp.id || 'resp_translated',
    type: 'message',
    role: 'assistant',
    content,
    model: openaiResp.model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: openaiResp.usage?.input_tokens || 0,
      output_tokens: openaiResp.usage?.output_tokens || 0,
    },
  };
}

async function forwardToOpenAI(body: any): Promise<{ status: number; body: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { status: 500, body: 'no OPENAI_API_KEY configured' };

  const { instructions, input } = translateMessagesToOpenAI(body.messages, body.system);
  const tools = translateToolsToOpenAI(body.tools);

  const openaiBody: any = {
    model: body.model,
    input,
    max_output_tokens: body.max_tokens || 16384,
  };
  if (instructions) openaiBody.instructions = instructions;
  if (tools.length) openaiBody.tools = tools;

  const upstream = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(openaiBody),
  });

  const rawResp = await upstream.text();

  if (!upstream.ok) {
    return { status: upstream.status, body: rawResp };
  }

  let openaiResp: any;
  try {
    openaiResp = JSON.parse(rawResp);
  } catch {
    return { status: 502, body: 'failed to parse OpenAI response' };
  }

  const translated = translateResponseToAnthropic(openaiResp);
  return { status: 200, body: JSON.stringify(translated) };
}

async function forwardToAnthropic(body: string, anthropicVersion: string): Promise<{ status: number; body: string; contentType: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { status: 500, body: 'no ANTHROPIC_API_KEY configured', contentType: 'text/plain' };

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': anthropicVersion,
    },
    body,
  });

  const respBody = await upstream.text();
  return {
    status: upstream.status,
    body: respBody,
    contentType: upstream.headers.get('content-type') || 'application/json',
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

// --- Anthropic-to-OpenAI Chat Completions translation (for OpenRouter) ---

export function translateMessagesToChat(messages: any[], system?: string | any[]): { systemMessage: string | undefined; chatMessages: any[] } {
  let systemMessage: string | undefined;
  if (Array.isArray(system)) {
    systemMessage = system.map((b: any) => b.text || '').filter(Boolean).join('\n');
  } else {
    systemMessage = system || undefined;
  }

  const chatMessages: any[] = [];

  for (const msg of messages) {
    const content = msg.content;

    if (msg.role === 'user') {
      if (typeof content === 'string') {
        chatMessages.push({ role: 'user', content });
      } else if (Array.isArray(content)) {
        // Accumulate all non-tool blocks into a single user message to avoid
        // consecutive same-role messages (rejected by OpenAI/OpenRouter).
        const userParts: any[] = [];
        for (const block of content) {
          if (block.type === 'tool_result') {
            // Flush accumulated user parts before the tool result
            if (userParts.length) {
              chatMessages.push({ role: 'user', content: userParts.length === 1 && userParts[0].type === 'text' ? userParts[0].text : [...userParts] });
              userParts.length = 0;
            }
            const outputText = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map((b: any) => b.text || '').join('\n')
                : JSON.stringify(block.content);
            chatMessages.push({
              role: 'tool',
              tool_call_id: block.tool_use_id,
              content: outputText,
            });
          } else if (block.type === 'text') {
            userParts.push({ type: 'text', text: block.text });
          } else if (block.type === 'image') {
            const url = anthropicImageToDataUrl(block.source);
            if (url) {
              userParts.push({ type: 'image_url', image_url: { url } });
            }
          }
        }
        // Flush remaining user parts
        if (userParts.length) {
          chatMessages.push({ role: 'user', content: userParts.length === 1 && userParts[0].type === 'text' ? userParts[0].text : [...userParts] });
        }
      }
    } else if (msg.role === 'assistant') {
      if (typeof content === 'string') {
        chatMessages.push({ role: 'assistant', content });
      } else if (Array.isArray(content)) {
        const textParts: string[] = [];
        const toolCalls: any[] = [];
        for (const block of content) {
          if (block.type === 'text') {
            textParts.push(block.text);
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input),
              },
            });
          }
        }
        const assistantMsg: any = { role: 'assistant' };
        if (textParts.length) assistantMsg.content = textParts.join('\n');
        if (toolCalls.length) assistantMsg.tool_calls = toolCalls;
        chatMessages.push(assistantMsg);
      }
    }
  }

  return { systemMessage, chatMessages };
}

export function translateToolsToChat(tools: any[]): any[] {
  if (!tools?.length) return [];
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.input_schema || {},
    },
  }));
}

export function translateChatResponseToAnthropic(chatResp: any): any {
  const content: any[] = [];
  let hasToolUse = false;

  const choice = chatResp.choices?.[0];
  if (!choice) {
    return {
      id: chatResp.id || 'resp_translated',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      model: chatResp.model,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: chatResp.usage?.prompt_tokens || 0,
        output_tokens: chatResp.usage?.completion_tokens || 0,
      },
    };
  }

  const msg = choice.message;
  if (msg.content) {
    content.push({ type: 'text', text: msg.content });
  }

  if (msg.tool_calls?.length) {
    hasToolUse = true;
    for (const tc of msg.tool_calls) {
      let parsedInput: any;
      try {
        parsedInput = JSON.parse(tc.function.arguments);
      } catch {
        parsedInput = {};
      }
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: parsedInput,
      });
    }
  }

  const stopReason = hasToolUse ? 'tool_use' : 'end_turn';

  return {
    id: chatResp.id || 'resp_translated',
    type: 'message',
    role: 'assistant',
    content,
    model: chatResp.model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: chatResp.usage?.prompt_tokens || 0,
      output_tokens: chatResp.usage?.completion_tokens || 0,
    },
  };
}

async function forwardToOpenRouter(body: any): Promise<{ status: number; body: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { status: 500, body: 'no OPENROUTER_API_KEY configured' };

  const { systemMessage, chatMessages } = translateMessagesToChat(body.messages, body.system);
  const tools = translateToolsToChat(body.tools);

  const messages: any[] = [];
  if (systemMessage) messages.push({ role: 'system', content: systemMessage });
  messages.push(...chatMessages);

  const openrouterBody: any = {
    model: body.model,
    messages,
    max_tokens: body.max_tokens || 16384,
  };
  if (tools.length) openrouterBody.tools = tools;

  const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(openrouterBody),
  });

  const rawResp = await upstream.text();
  if (!upstream.ok) return { status: upstream.status, body: rawResp };

  let chatResp: any;
  try {
    chatResp = JSON.parse(rawResp);
  } catch {
    return { status: 502, body: 'failed to parse OpenRouter response' };
  }

  const translated = translateChatResponseToAnthropic(chatResp);
  return { status: 200, body: JSON.stringify(translated) };
}

// --- Anthropic-to-Gemini translation ---

export function translateMessagesToGemini(messages: any[], system?: string | any[]): { systemInstruction: any | undefined; contents: any[] } {
  let systemInstruction: any | undefined;
  if (Array.isArray(system)) {
    const text = system.map((b: any) => b.text || '').filter(Boolean).join('\n');
    if (text) systemInstruction = { parts: [{ text }] };
  } else if (system) {
    systemInstruction = { parts: [{ text: system }] };
  }

  const contents: any[] = [];

  for (const msg of messages) {
    const content = msg.content;

    if (msg.role === 'user') {
      if (typeof content === 'string') {
        contents.push({ role: 'user', parts: [{ text: content }] });
      } else if (Array.isArray(content)) {
        const parts: any[] = [];
        for (const block of content) {
          if (block.type === 'tool_result') {
            const outputText = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map((b: any) => b.text || '').join('\n')
                : JSON.stringify(block.content);
            parts.push({
              functionResponse: {
                name: block.tool_use_id, // Gemini uses name, but we store tool_use_id here
                response: { result: outputText },
              },
            });
          } else if (block.type === 'text') {
            parts.push({ text: block.text });
          } else if (block.type === 'image') {
            if (block.source?.type === 'base64' && block.source.data && block.source.media_type) {
              parts.push({
                inlineData: {
                  mimeType: block.source.media_type,
                  data: block.source.data,
                },
              });
            }
            // Gemini doesn't support URL-based images directly; warn and skip
            if (block.source?.type === 'url') {
              console.warn('[proxy] Gemini: dropping URL-based image block (not supported inline)');
            }
          }
        }
        if (parts.length) contents.push({ role: 'user', parts });
      }
    } else if (msg.role === 'assistant') {
      if (typeof content === 'string') {
        contents.push({ role: 'model', parts: [{ text: content }] });
      } else if (Array.isArray(content)) {
        const parts: any[] = [];
        for (const block of content) {
          if (block.type === 'text') {
            parts.push({ text: block.text });
          } else if (block.type === 'tool_use') {
            parts.push({
              functionCall: {
                name: block.name,
                args: block.input,
              },
            });
          }
        }
        if (parts.length) contents.push({ role: 'model', parts });
      }
    }
  }

  return { systemInstruction, contents };
}

export function translateToolsToGemini(tools: any[]): any[] {
  if (!tools?.length) return [];
  return [{
    functionDeclarations: tools.map(t => ({
      name: t.name,
      description: t.description || '',
      parameters: t.input_schema || { type: 'object', properties: {} },
    })),
  }];
}

export function translateGeminiResponseToAnthropic(geminiResp: any, model: string): any {
  const content: any[] = [];
  let hasToolUse = false;

  const candidate = geminiResp.candidates?.[0];
  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.text) {
        content.push({ type: 'text', text: part.text });
      } else if (part.functionCall) {
        hasToolUse = true;
        content.push({
          type: 'tool_use',
          id: `toolu_${Math.random().toString(36).slice(2, 14)}`,
          name: part.functionCall.name,
          input: part.functionCall.args || {},
        });
      }
    }
  }

  if (!content.length) {
    content.push({ type: 'text', text: '' });
  }

  const stopReason = hasToolUse ? 'tool_use' : 'end_turn';

  return {
    id: `msg_${Math.random().toString(36).slice(2, 14)}`,
    type: 'message',
    role: 'assistant',
    content,
    model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: geminiResp.usageMetadata?.promptTokenCount || 0,
      output_tokens: geminiResp.usageMetadata?.candidatesTokenCount || 0,
    },
  };
}

async function forwardToGemini(body: any): Promise<{ status: number; body: string }> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return { status: 500, body: 'no GOOGLE_API_KEY configured' };

  const model = body.model || 'gemini-2.5-flash';
  const { systemInstruction, contents } = translateMessagesToGemini(body.messages, body.system);
  const tools = translateToolsToGemini(body.tools);

  const geminiBody: any = {
    contents,
    generationConfig: {
      maxOutputTokens: body.max_tokens || 16384,
    },
  };
  if (systemInstruction) geminiBody.systemInstruction = systemInstruction;
  if (tools.length) geminiBody.tools = tools;

  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(geminiBody),
    },
  );

  const rawResp = await upstream.text();
  if (!upstream.ok) return { status: upstream.status, body: rawResp };

  let geminiResp: any;
  try {
    geminiResp = JSON.parse(rawResp);
  } catch {
    return { status: 502, body: 'failed to parse Gemini response' };
  }

  const translated = translateGeminiResponseToAnthropic(geminiResp, model);
  return { status: 200, body: JSON.stringify(translated) };
}

export async function handleLLMProxy(
  req: IncomingMessage,
  res: ServerResponse,
  costs: CostTracker,
  checkBudget?: BudgetChecker,
  onBudgetExceeded?: (creatureName: string) => void,
  onModelSeen?: (creatureName: string, model: string) => void,
): Promise<void> {
  const apiKeyHeader = req.headers['x-api-key'] as string || '';
  const creatureName = apiKeyHeader.startsWith('creature:')
    ? apiKeyHeader.slice(9)
    : (req.headers['x-creature-name'] as string || 'unknown');

  // Budget pre-check: block if already over daily cap
  if (checkBudget) {
    const budget = checkBudget(creatureName);
    if (!budget.allowed) {
      if (budget.action === 'sleep') {
        const msg = `Daily spending cap of $${budget.dailyCap.toFixed(2)} reached ($${budget.dailySpent.toFixed(2)} spent today). Creature will sleep until daily reset.`;
        console.log(`[proxy:${creatureName}] BUDGET EXCEEDED: ${msg}`);
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          type: 'error',
          error: { type: 'rate_limit_error', message: msg },
        }));
        onBudgetExceeded?.(creatureName);
        return;
      }
      if (budget.action === 'warn') {
        console.log(`[proxy:${creatureName}] WARNING: daily spend $${budget.dailySpent.toFixed(2)} exceeds cap $${budget.dailyCap.toFixed(2)}`);
      }
    }
  }

  const rawBody = await readBody(req);

  let parsed: any;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    res.writeHead(400);
    res.end('invalid JSON');
    return;
  }

  const model = parsed.model || 'claude-opus-4-6';
  const provider = inferProvider(model);
  if (onModelSeen) onModelSeen(creatureName, model);

  try {
    if (provider === 'openrouter') {
      const result = await forwardToOpenRouter(parsed);

      try {
        const respParsed = JSON.parse(result.body);
        if (respParsed.usage) {
          costs.record(creatureName, respParsed.usage.input_tokens || 0, respParsed.usage.output_tokens || 0, model);
          if (checkBudget && onBudgetExceeded) {
            const budget = checkBudget(creatureName);
            if (!budget.allowed && budget.action === 'sleep') {
              console.log(`[proxy:${creatureName}] call pushed over daily budget ($${budget.dailySpent.toFixed(2)} / $${budget.dailyCap.toFixed(2)})`);
              onBudgetExceeded(creatureName);
            }
          }
        }
        if (respParsed.stop_reason) {
          console.log(`[proxy:${creatureName}] model=${model} stop_reason=${respParsed.stop_reason} content_blocks=${(respParsed.content || []).length}`);
        }
      } catch {}

      res.writeHead(result.status, { 'content-type': 'application/json' });
      res.end(result.body);
    } else if (provider === 'gemini') {
      const result = await forwardToGemini(parsed);

      try {
        const respParsed = JSON.parse(result.body);
        if (respParsed.usage) {
          costs.record(creatureName, respParsed.usage.input_tokens || 0, respParsed.usage.output_tokens || 0, model);
          if (checkBudget && onBudgetExceeded) {
            const budget = checkBudget(creatureName);
            if (!budget.allowed && budget.action === 'sleep') {
              console.log(`[proxy:${creatureName}] call pushed over daily budget ($${budget.dailySpent.toFixed(2)} / $${budget.dailyCap.toFixed(2)})`);
              onBudgetExceeded(creatureName);
            }
          }
        }
        if (respParsed.stop_reason) {
          console.log(`[proxy:${creatureName}] model=${model} stop_reason=${respParsed.stop_reason} content_blocks=${(respParsed.content || []).length}`);
        }
      } catch {}

      res.writeHead(result.status, { 'content-type': 'application/json' });
      res.end(result.body);
    } else if (provider === 'openai') {
      const result = await forwardToOpenAI(parsed);

      try {
        const respParsed = JSON.parse(result.body);
        if (respParsed.usage) {
          costs.record(creatureName, respParsed.usage.input_tokens || 0, respParsed.usage.output_tokens || 0, model);
          if (checkBudget && onBudgetExceeded) {
            const budget = checkBudget(creatureName);
            if (!budget.allowed && budget.action === 'sleep') {
              console.log(`[proxy:${creatureName}] call pushed over daily budget ($${budget.dailySpent.toFixed(2)} / $${budget.dailyCap.toFixed(2)})`);
              onBudgetExceeded(creatureName);
            }
          }
        }
        if (respParsed.stop_reason) {
          console.log(`[proxy:${creatureName}] model=${model} stop_reason=${respParsed.stop_reason} content_blocks=${(respParsed.content || []).length}`);
        }
      } catch {}

      res.writeHead(result.status, { 'content-type': 'application/json' });
      res.end(result.body);
    } else {
      const anthropicVersion = req.headers['anthropic-version'] as string || '2023-06-01';
      const result = await forwardToAnthropic(rawBody, anthropicVersion);

      try {
        const respParsed = JSON.parse(result.body);
        if (respParsed.usage) {
          costs.record(creatureName, respParsed.usage.input_tokens || 0, respParsed.usage.output_tokens || 0, model);
          if (checkBudget && onBudgetExceeded) {
            const budget = checkBudget(creatureName);
            if (!budget.allowed && budget.action === 'sleep') {
              console.log(`[proxy:${creatureName}] call pushed over daily budget ($${budget.dailySpent.toFixed(2)} / $${budget.dailyCap.toFixed(2)})`);
              onBudgetExceeded(creatureName);
            }
          }
        }
        if (respParsed.stop_reason) {
          console.log(`[proxy:${creatureName}] model=${model} stop_reason=${respParsed.stop_reason} content_blocks=${(respParsed.content || []).length}`);
        }
      } catch {}

      res.writeHead(result.status, { 'content-type': result.contentType });
      res.end(result.body);
    }
  } catch (err) {
    console.error(`[proxy] LLM proxy error for ${creatureName} (${model}):`, err instanceof Error ? err.message : String(err));
    sendErrorResponse(res, err, 502);
  }
}
