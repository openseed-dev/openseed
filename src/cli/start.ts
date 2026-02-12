import { readOrchestratorInfo } from './ports.js';

interface StartOptions {
  name: string;
  manual: boolean;
  bare: boolean;
}

export async function start(opts: StartOptions): Promise<void> {
  const info = await readOrchestratorInfo();
  if (!info) {
    console.error('orchestrator is not running. start it with: itsalive up');
    process.exit(1);
  }

  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/api/creatures/${opts.name}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bare: opts.bare, manual: opts.manual }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`failed to start "${opts.name}": ${text}`);
      process.exit(1);
    }

    console.log(`creature "${opts.name}" started`);
    console.log(`  dashboard: http://localhost:${info.port}`);
  } catch (err) {
    console.error('failed to reach orchestrator:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
