import fs from 'node:fs/promises';
import path from 'node:path';

import { Event } from '../shared/types.js';
import { stripImageData } from '../shared/image-utils.js';

export class EventStore {
  private eventsFile: string;
  private listeners: Set<(event: Event) => void> = new Set();

  constructor(creatureDir: string) {
    const selfDir = path.join(creatureDir, ".sys");
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
    // Strip any base64 image data before persisting to disk.
    // Images in tool results (e.g. from a `see` tool) can be multi-MB;
    // serializing them to event logs wastes disk and makes logs unreadable.
    const sanitized = stripImageData(event);
    const line = JSON.stringify(sanitized) + "\n";
    await fs.appendFile(this.eventsFile, line, "utf-8");
    // Notify listeners with the original event (they may need images for
    // real-time dashboard display, thumbnails, etc.)
    this.listeners.forEach((fn) => fn(event));
  }

  async readAll(): Promise<Event[]> {
    const content = await fs.readFile(this.eventsFile, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  }

  async readRecent(n: number): Promise<Event[]> {
    const all = await this.readAll();
    return all.slice(-n);
  }

  subscribe(fn: (event: Event) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
