import { spawn } from 'node:child_process';
import path from 'node:path';

import { readOrchestratorInfo } from './ports.js';

interface UpOptions {
  port?: number;
}

export async function up(opts: UpOptions): Promise<void> {
  const port = opts.port || Number(process.env.ORCHESTRATOR_PORT) || 7770;

  const existing = await readOrchestratorInfo();
  if (existing) {
    console.error(`orchestrator is already running (pid ${existing.pid}, port ${existing.port})`);
    console.error(`  dashboard: http://localhost:${existing.port}`);
    process.exit(1);
  }

  console.log(`starting orchestrator on port ${port}...`);
  console.log(`  dashboard: http://localhost:${port}`);

  const hostScript = path.resolve(import.meta.dirname, '..', 'host', 'index.ts');

  const child = spawn('tsx', [hostScript], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ORCHESTRATOR_PORT: String(port),
    },
  });

  child.on('exit', (code) => process.exit(code ?? 1));
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
}
