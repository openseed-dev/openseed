import fs from "node:fs/promises";
import path from "node:path";
import { Event } from "../shared/types.js";

const EVENTS_DIR = ".self";
const EVENTS_FILE = path.join(EVENTS_DIR, "events.jsonl");

export class EventStore {
  private listeners: Set<(event: Event) => void> = new Set();

  async init() {
    await fs.mkdir(EVENTS_DIR, { recursive: true });
    try {
      await fs.access(EVENTS_FILE);
    } catch {
      await fs.writeFile(EVENTS_FILE, "", "utf-8");
    }
  }

  async append(event: Event) {
    const line = JSON.stringify(event) + "\n";
    await fs.appendFile(EVENTS_FILE, line, "utf-8");
    this.listeners.forEach(fn => fn(event));
  }

  async readAll(): Promise<Event[]> {
    const content = await fs.readFile(EVENTS_FILE, "utf-8");
    return content
      .split("\n")
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  }

  subscribe(fn: (event: Event) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event: Event) {
    this.append(event);
  }
}

export function createSSEStream(store: EventStore) {
  return (req: any, res: any) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const unsub = store.subscribe((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    req.on("close", () => {
      unsub();
    });
  };
}
