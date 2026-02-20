export interface CreatureInfo {
  name: string;
  status: 'stopped' | 'starting' | 'running' | 'sleeping' | 'error';
  model?: string;
  sha?: string;
  sleepReason?: string;
}

export interface BudgetInfo {
  daily_cap_usd: number;
  daily_spent_usd: number;
  action: 'sleep' | 'warn' | 'off';
  status?: string;
}

export interface GlobalBudget {
  daily_usd: number;
  action: 'sleep' | 'warn' | 'off';
}

export interface NarrationEntry {
  t: string;
  text: string;
  blocks?: Record<string, string>;
  creatures_mentioned?: string[];
}

export interface MindData {
  tabs?: Array<{ id: string; label?: string; type?: string }>;
  data?: Record<string, any>;
}

export interface CreatureEvent {
  t?: string;
  type: string;
  creature?: string;
  text?: string;
  // sleep
  seconds?: number;
  actions?: number;
  // wake
  source?: string;
  reason?: string;
  // tool_call
  tool?: string;
  input?: string;
  output?: string;
  ok?: boolean;
  ms?: number;
  // dream
  deep?: boolean;
  observations?: number;
  priority?: string;
  reflection?: string;
  // error
  error?: string;
  retryIn?: number;
  retries?: number;
  // evaluation
  changed?: boolean;
  changes?: any[];
  reasoning?: string;
  trigger?: string;
  // host events
  sha?: string;
  pid?: number;
  from?: string;
  to?: string;
  // budget
  daily_spent?: number;
  daily_cap?: number;
  daily_spent_usd?: number;
  daily_cap_usd?: number;
  [key: string]: any;
}

export interface GenomeInfo {
  name: string;
  description?: string;
  source: string;
}

export interface UsageData {
  usage: Record<string, { cost_usd?: number; daily_date?: string; daily_cost_usd?: number }>;
  total: number;
}
