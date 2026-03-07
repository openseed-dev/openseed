import {
  getModelIds,
  isKnownModel,
} from '../shared/models.js';
import { spawnCreature } from '../shared/spawn.js';

interface SpawnOptions {
  name: string;
  purpose?: string;
  genome?: string;
  model?: string;
}

export async function spawn(opts: SpawnOptions): Promise<void> {
  if (opts.model && !isKnownModel(opts.model)) {
    console.error(`unknown model "${opts.model}". known models: ${getModelIds().join(', ')}`);
    process.exit(1);
  }

  console.log(`spawning creature "${opts.name}"${opts.model ? ` with model ${opts.model}` : ''}...`);

  const result = await spawnCreature({
    name: opts.name,
    purpose: opts.purpose,
    genome: opts.genome,
    model: opts.model,
  });

  console.log(`creature "${result.name}" spawned at ${result.dir}`);
  console.log(`  id: ${result.id}`);
  console.log(`  born: ${result.born}`);
  console.log(`\nstart it with: seed start ${result.name}`);
}
