#!/usr/bin/env tsx

import { destroy } from './destroy.js';
import { fork } from './fork.js';
import {
  genomeInstall,
  genomeList,
  genomeRemove,
  genomeSearch,
} from './genome.js';
import { list } from './list.js';
import { spawn } from './spawn.js';
import { start } from './start.js';
import { stop } from './stop.js';
import { up } from './up.js';

const [command, ...args] = process.argv.slice(2);

function usage(): never {
  console.log(`openseed: autonomous creature framework

commands:
  up [--port 7770]                start the orchestrator + dashboard
  spawn <name> [--purpose "..."] [--genome <name>] [--model <model>]  create a new creature
  start <name> [--manual]          start a creature (requires orchestrator)
  stop <name>                      stop a running creature
  list                             list all creatures and their status
  destroy <name>                   stop and remove a creature
  fork <source> <name>             fork a creature (copies full git history)
  genome install <source>          install a genome (github user/repo or shorthand name)
  genome list                      list installed and bundled genomes
  genome remove <name>             remove an installed genome

options:
  --port <n>                       orchestrator port (default 7770)
  --manual                         don't auto-start cognition loop
  --help                           show this help
`);
  process.exit(0);
}

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

async function main() {
  if (!command || command === "--help" || command === "-h") {
    usage();
  }

  switch (command) {
    case "up": {
      const portStr = parseFlag(args, "--port");
      const port = portStr ? parseInt(portStr) : undefined;
      await up({ port });
      break;
    }

    case "spawn": {
      const name = args.find((a) => !a.startsWith("--"));
      if (!name) {
        console.error("usage: seed spawn <name> [--purpose \"...\"]");
        process.exit(1);
      }
      const purpose = parseFlag(args, "--purpose");
      const genome = parseFlag(args, "--genome");
      const model = parseFlag(args, "--model");
      await spawn({ name, purpose, genome: genome || undefined, model: model || undefined });
      break;
    }

    case "start": {
      const name = args.find((a) => !a.startsWith("--"));
      if (!name) {
        console.error("usage: seed start <name> [--manual]");
        process.exit(1);
      }
      const manual = hasFlag(args, "--manual");
      await start({ name, manual });
      break;
    }

    case "stop": {
      const name = args[0];
      if (!name) {
        console.error("usage: seed stop <name>");
        process.exit(1);
      }
      await stop({ name });
      break;
    }

    case "list": {
      await list();
      break;
    }

    case "destroy": {
      const name = args[0];
      if (!name) {
        console.error("usage: seed destroy <name>");
        process.exit(1);
      }
      await destroy({ name });
      break;
    }

    case "fork": {
      const source = args[0];
      const name = args[1];
      if (!source || !name) {
        console.error("usage: seed fork <source> <name>");
        process.exit(1);
      }
      await fork({ source, name });
      break;
    }

    case "genome": {
      const sub = args[0];
      if (sub === "install") {
        const source = args[1];
        if (!source) {
          console.error("usage: seed genome install <source>");
          console.error("  source: genome name (e.g. dreamer), or github user/repo");
          process.exit(1);
        }
        await genomeInstall(source);
      } else if (sub === "list" || sub === "ls") {
        await genomeList();
      } else if (sub === "remove" || sub === "rm") {
        const name = args[1];
        if (!name) {
          console.error("usage: seed genome remove <name>");
          process.exit(1);
        }
        await genomeRemove(name);
      } else if (sub === "search") {
        const query = args.slice(1).join(" ");
        if (!query) {
          console.error("usage: seed genome search <query>");
          process.exit(1);
        }
        await genomeSearch(query);
      } else {
        console.error("usage: seed genome <install|list|remove|search>");
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`unknown command: ${command}`);
      usage();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
