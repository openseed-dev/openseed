export type Provider = 'anthropic' | 'openai' | 'openrouter' | 'gemini';

export interface ModelEntry {
  id: string;
  provider: Provider;
  isDefault?: boolean;
}

const CATALOG: ModelEntry[] = [
  { id: 'claude-opus-4-6',    provider: 'anthropic', isDefault: true },
  { id: 'claude-sonnet-4-6',  provider: 'anthropic' },
  { id: 'claude-haiku-4-5',   provider: 'anthropic' },
  { id: 'gpt-5.4',            provider: 'openai' },
  { id: 'gpt-5.4-pro',        provider: 'openai' },
  { id: 'gpt-5.3-codex',      provider: 'openai' },
  { id: 'gpt-5.2',            provider: 'openai' },
  { id: 'gpt-5.2-codex',      provider: 'openai' },
  { id: 'gpt-5-mini',         provider: 'openai' },
];

export function getAllModels(): readonly ModelEntry[] {
  return CATALOG;
}

export function getModelIds(): string[] {
  return CATALOG.map(m => m.id);
}

export function getDefaultModel(): string {
  return CATALOG.find(m => m.isDefault)?.id ?? CATALOG[0].id;
}

export function isKnownModel(id: string): boolean {
  return CATALOG.some(m => m.id === id);
}
