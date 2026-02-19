import type {
  IncomingMessage,
  ServerResponse,
} from 'node:http';

import type { CostTracker } from './costs.js';

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

function inferProvider(model: string): 'anthropic' | 'openai' {
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('gpt-') || model.startsWith('o3') || model.startsWith('o4')) return 'openai';
  return 'anthropic'; // safe default
}

// --- Anthropic-to-OpenAI translation ---

function translateToolsToOpenAI(tools: any[]): any[] {
  if (!tools?.length) return [];
  return tools.map(t => ({
    type: 'function' as const,
    name: t.name,
    description: t.description || '',
    parameters: t.input_schema || {},
  }));
}

function translateMessagesToOpenAI(messages: any[], system?: string | any[]): { instructions: string | undefined; input: any[] } {
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

function translateResponseToAnthropic(openaiResp: any): any {
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
    if (provider === 'openai') {
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
  } catch (err: any) {
    console.error(`[proxy] LLM proxy error for ${creatureName} (${model}):`, err.message);
    res.writeHead(502);
    res.end('proxy error');
  }
}
