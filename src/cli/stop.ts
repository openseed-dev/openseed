import { readOrchestratorInfo } from './ports.js';

interface StopOptions {
  name: string;
}

export async function stop(opts: StopOptions): Promise<void> {
  const info = await readOrchestratorInfo();
  if (!info) {
    console.error('orchestrator is not running');
    process.exit(1);
  }

  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/api/creatures/${opts.name}/stop`, {
      method: 'POST',
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`failed to stop "${opts.name}": ${text}`);
      process.exit(1);
    }

    console.log(`creature "${opts.name}" stopped`);
  } catch (err) {
    console.error('failed to reach orchestrator:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
