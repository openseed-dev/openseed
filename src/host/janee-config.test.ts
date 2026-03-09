import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  hasYAMLConfig,
  loadYAMLConfig,
  saveYAMLConfig,
  addServiceYAML,
  addCapabilityYAML,
} from '@true-and-useful/janee';
import {
  readJaneeConfig,
  addService,
  updateService,
  deleteService,
  addCapability,
  updateCapability,
  deleteCapability,
  updateCapabilityAgents,
} from './janee-config.js';

// Helper: configure mocks to simulate a given config state
function setupConfig(config: any) {
  const exists = config !== null;
  (hasYAMLConfig as ReturnType<typeof vi.fn>).mockReturnValue(exists);
  if (exists) {
    (loadYAMLConfig as ReturnType<typeof vi.fn>).mockReturnValue(
      JSON.parse(JSON.stringify(config)),
    );
  } else {
    (loadYAMLConfig as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('No janee.yaml');
    });
  }

  // saveYAMLConfig should update what loadYAMLConfig returns
  (saveYAMLConfig as ReturnType<typeof vi.fn>).mockImplementation((c: any) => {
    (hasYAMLConfig as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (loadYAMLConfig as ReturnType<typeof vi.fn>).mockReturnValue(
      JSON.parse(JSON.stringify(c)),
    );
  });

  // addServiceYAML: read config, add service, save
  (addServiceYAML as ReturnType<typeof vi.fn>).mockImplementation(
    (name: string, baseUrl: string, auth: any) => {
      const current = exists
        ? JSON.parse(JSON.stringify(config))
        : { services: {}, capabilities: {} };
      current.services[name] = { baseUrl, auth };
      config = current;
      (loadYAMLConfig as ReturnType<typeof vi.fn>).mockReturnValue(
        JSON.parse(JSON.stringify(current)),
      );
      (hasYAMLConfig as ReturnType<typeof vi.fn>).mockReturnValue(true);
    },
  );

  // addCapabilityYAML: similar
  (addCapabilityYAML as ReturnType<typeof vi.fn>).mockImplementation(
    (name: string, cap: any) => {
      const current = exists
        ? JSON.parse(JSON.stringify(config))
        : { services: {}, capabilities: {} };
      current.capabilities[name] = cap;
      config = current;
      (loadYAMLConfig as ReturnType<typeof vi.fn>).mockReturnValue(
        JSON.parse(JSON.stringify(current)),
      );
      (hasYAMLConfig as ReturnType<typeof vi.fn>).mockReturnValue(true);
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// readJaneeConfig
// ─────────────────────────────────────────────────────────────────────────────

describe('readJaneeConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConfig(null);
  });

  it('returns unavailable view when no config exists', () => {
    const view = readJaneeConfig();
    expect(view.available).toBe(false);
    expect(view.services).toEqual([]);
    expect(view.capabilities).toEqual([]);
    expect(view.agents).toEqual([]);
  });

  it('returns masked services without auth secrets', () => {
    setupConfig({
      services: {
        github: {
          baseUrl: 'https://api.github.com',
          auth: { type: 'bearer', token: 'ghp_SUPERSECRET123' },
        },
      },
      capabilities: {},
    });

    const view = readJaneeConfig();
    expect(view.available).toBe(true);
    expect(view.services).toHaveLength(1);
    expect(view.services[0].name).toBe('github');
    expect(view.services[0].baseUrl).toBe('https://api.github.com');
    expect(view.services[0].authType).toBe('bearer');
    // Secret MUST NOT be in the output
    expect(JSON.stringify(view)).not.toContain('SUPERSECRET');
  });

  it('maps capabilities with all fields', () => {
    setupConfig({
      services: {
        github: {
          baseUrl: 'https://api.github.com',
          auth: { type: 'bearer', token: 'x' },
        },
      },
      capabilities: {
        'github-repos': {
          service: 'github',
          mode: 'proxy',
          ttl: '1h',
          requiresReason: true,
          rules: { allow: ['/repos/**'], deny: ['/admin/**'] },
          allowedAgents: ['creature-1', 'creature-2'],
        },
      },
    });

    const view = readJaneeConfig();
    expect(view.capabilities).toHaveLength(1);
    const cap = view.capabilities[0];
    expect(cap.name).toBe('github-repos');
    expect(cap.service).toBe('github');
    expect(cap.mode).toBe('proxy');
    expect(cap.ttl).toBe('1h');
    expect(cap.requiresReason).toBe(true);
    expect(cap.rules).toEqual({ allow: ['/repos/**'], deny: ['/admin/**'] });
    expect(cap.allowedAgents).toEqual(['creature-1', 'creature-2']);
  });

  it('derives agent list from capabilities', () => {
    setupConfig({
      services: {
        github: {
          baseUrl: 'https://api.github.com',
          auth: { type: 'bearer', token: 'x' },
        },
      },
      capabilities: {
        'github-repos': {
          service: 'github',
          ttl: '1h',
          allowedAgents: ['agent-a', 'agent-b'],
        },
        'github-actions': {
          service: 'github',
          ttl: '30m',
          allowedAgents: ['agent-a'],
        },
      },
    });

    const view = readJaneeConfig();
    expect(view.agents).toHaveLength(2);

    const agentA = view.agents.find((a: any) => a.agentId === 'agent-a');
    expect(agentA?.capabilities).toEqual(['github-repos', 'github-actions']);

    const agentB = view.agents.find((a: any) => a.agentId === 'agent-b');
    expect(agentB?.capabilities).toEqual(['github-repos']);
  });

  it('includes server settings when present', () => {
    setupConfig({
      server: { port: 8080, host: '0.0.0.0', defaultAccess: 'deny' },
      services: {},
      capabilities: {},
    });

    const view = readJaneeConfig();
    expect(view.server).toEqual({
      port: 8080,
      host: '0.0.0.0',
      defaultAccess: 'deny',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteService — removes service + cascades to capabilities
// ─────────────────────────────────────────────────────────────────────────────

describe('deleteService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConfig({
      services: {
        github: {
          baseUrl: 'https://api.github.com',
          auth: { type: 'bearer', token: 'x' },
        },
        slack: {
          baseUrl: 'https://slack.com/api',
          auth: { type: 'bearer', token: 'y' },
        },
      },
      capabilities: {
        'github-repos': { service: 'github', ttl: '1h' },
        'github-actions': { service: 'github', ttl: '30m' },
        'slack-post': { service: 'slack', ttl: '5m' },
      },
    });
  });

  it('removes service and its capabilities', () => {
    const view = deleteService('github');
    expect(view.services.map((s: any) => s.name)).toEqual(['slack']);
    expect(view.capabilities.map((c: any) => c.name)).toEqual(['slack-post']);
  });

  it('keeps unrelated services intact', () => {
    const view = deleteService('github');
    expect(view.services).toHaveLength(1);
    expect(view.services[0].name).toBe('slack');
    expect(view.services[0].baseUrl).toBe('https://slack.com/api');
  });

  it('throws on nonexistent service', () => {
    expect(() => deleteService('nonexistent')).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateService
// ─────────────────────────────────────────────────────────────────────────────

describe('updateService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConfig({
      services: {
        github: {
          baseUrl: 'https://api.github.com',
          auth: { type: 'bearer', token: 'x' },
        },
      },
      capabilities: {},
    });
  });

  it('updates baseUrl', () => {
    const view = updateService('github', { baseUrl: 'https://api.github.com/v2' });
    expect(view.services[0].baseUrl).toBe('https://api.github.com/v2');
  });

  it('throws on nonexistent service', () => {
    expect(() => updateService('missing', { baseUrl: 'x' })).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// addService
// ─────────────────────────────────────────────────────────────────────────────

describe('addService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConfig({ services: {}, capabilities: {} });
  });

  it('adds a new service', () => {
    const view = addService('newSvc', 'http://example.com', { type: 'none' } as any);
    expect(view.available).toBe(true);
    const found = view.services.find((s: any) => s.name === 'newSvc');
    expect(found).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// addCapability
// ─────────────────────────────────────────────────────────────────────────────

describe('addCapability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConfig({
      services: {
        github: {
          baseUrl: 'https://api.github.com',
          auth: { type: 'bearer', token: 'x' },
        },
      },
      capabilities: {},
    });
  });

  it('adds a capability', () => {
    const view = addCapability('github-repos', {
      service: 'github',
      ttl: '1h',
    } as any);
    const found = view.capabilities.find((c: any) => c.name === 'github-repos');
    expect(found).toBeDefined();
    expect(found?.service).toBe('github');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateCapability
// ─────────────────────────────────────────────────────────────────────────────

describe('updateCapability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConfig({
      services: {
        github: {
          baseUrl: 'https://api.github.com',
          auth: { type: 'bearer', token: 'x' },
        },
      },
      capabilities: {
        'github-repos': { service: 'github', ttl: '1h', mode: 'proxy' },
      },
    });
  });

  it('updates ttl and mode', () => {
    const view = updateCapability('github-repos', {
      ttl: '30m',
      mode: 'passthrough',
    } as any);
    expect(view.capabilities[0].ttl).toBe('30m');
    expect(view.capabilities[0].mode).toBe('passthrough');
  });

  it('preserves unmodified fields', () => {
    const view = updateCapability('github-repos', { ttl: '30m' } as any);
    expect(view.capabilities[0].service).toBe('github');
    expect(view.capabilities[0].mode).toBe('proxy');
  });

  it('throws on nonexistent capability', () => {
    expect(() => updateCapability('missing', { ttl: '1m' } as any)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteCapability
// ─────────────────────────────────────────────────────────────────────────────

describe('deleteCapability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConfig({
      services: {
        github: {
          baseUrl: 'https://api.github.com',
          auth: { type: 'bearer', token: 'x' },
        },
      },
      capabilities: {
        'github-repos': { service: 'github', ttl: '1h' },
        'github-actions': { service: 'github', ttl: '30m' },
      },
    });
  });

  it('removes only the specified capability', () => {
    const view = deleteCapability('github-repos');
    expect(view.capabilities.map((c: any) => c.name)).toEqual([
      'github-actions',
    ]);
  });

  it('throws on nonexistent capability', () => {
    expect(() => deleteCapability('nope')).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateCapabilityAgents
// ─────────────────────────────────────────────────────────────────────────────

describe('updateCapabilityAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConfig({
      services: {
        github: {
          baseUrl: 'https://api.github.com',
          auth: { type: 'bearer', token: 'x' },
        },
      },
      capabilities: {
        'github-repos': {
          service: 'github',
          ttl: '1h',
          allowedAgents: ['old-agent'],
        },
      },
    });
  });

  it('replaces agents list', () => {
    const view = updateCapabilityAgents('github-repos', [
      'new-agent-1',
      'new-agent-2',
    ]);
    expect(view.capabilities[0].allowedAgents).toEqual([
      'new-agent-1',
      'new-agent-2',
    ]);
    expect(view.agents).toHaveLength(2);
  });

  it('throws on nonexistent capability', () => {
    expect(() => updateCapabilityAgents('nope', ['x'])).toThrow();
  });
});
