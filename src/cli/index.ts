#!/usr/bin/env tsx

import { spawn } from "./spawn.js";
import { start } from "./start.js";
import { list } from "./list.js";
import { stop } from "./stop.js";
import { destroy } from "./destroy.js";
import { fork } from "./fork.js";

const [command, ...args] = process.argv.slice(2);

function usage(): never {
  console.log(`itsalive — creature hatchery

commands:
  spawn <name> [--purpose "..."]   create a new creature from template
  start <name> [--manual]          start a creature (host + creature process)
  stop <name>                      stop a running creature
  list                             list all creatures and their status
  destroy <name>                   stop and remove a creature
  fork <source> <name>             fork a creature (copies full git history)

options:
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
    case "spawn": {
      const name = args.find((a) => !a.startsWith("--"));
      if (!name) {
        console.error("usage: itsalive spawn <name> [--purpose \"...\"]");
        process.exit(1);
      }
      const purpose = parseFlag(args, "--purpose");
      await spawn({ name, purpose });
      break;
    }

    case "start": {
      const name = args.find((a) => !a.startsWith("--"));
      if (!name) {
        console.error("usage: itsalive start <name> [--manual]");
        process.exit(1);
      }
      const manual = hasFlag(args, "--manual");
      await start({ name, manual });
      break;
    }

    case "stop": {
      const name = args[0];
      if (!name) {
        console.error("usage: itsalive stop <name>");
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
        console.error("usage: itsalive destroy <name>");
        process.exit(1);
      }
      await destroy({ name });
      break;
    }

    case "fork": {
      const source = args[0];
      const name = args[1];
      if (!source || !name) {
        console.error("usage: itsalive fork <source> <name>");
        process.exit(1);
      }
      await fork({ source, name });
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
