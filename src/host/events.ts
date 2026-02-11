import fs from "node:fs/promises";
import path from "node:path";
import { Event } from "../shared/types.js";

export class EventStore {
  private eventsFile: string;
  private listeners: Set<(event: Event) => void> = new Set();

  constructor(creatureDir: string) {
    const selfDir = path.join(creatureDir, ".self");
    this.eventsFile = path.join(selfDir, "events.jsonl");
  }

  async init() {
    const dir = path.dirname(this.eventsFile);
    await fs.mkdir(dir, { recursive: true });
    try {
      await fs.access(this.eventsFile);
    } catch {
      await fs.writeFile(this.eventsFile, "", "utf-8");
    }
  }

  async append(event: Event) {
    const line = JSON.stringify(event) + "\n";
    await fs.appendFile(this.eventsFile, line, "utf-8");
    this.listeners.forEach((fn) => fn(event));
  }

  async readAll(): Promise<Event[]> {
    const content = await fs.readFile(this.eventsFile, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
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
