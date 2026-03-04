import fs from "node:fs/promises";
import path from "node:path";

import { Event } from "../shared/types.js";
import { stripImageData } from "../shared/image-utils.js";

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

  /**
   * Read the last N events from the log without loading the entire file.
   *
   * Reads 64KB chunks backwards from the end of the file, collecting
   * complete JSON lines until we have enough. For small files this is
   * equivalent to readAll().slice(-n); for large files it avoids loading
   * potentially hundreds of MB into memory.
   */
  async readRecent(n: number): Promise<Event[]> {
    const fd = await fs.open(this.eventsFile, "r");
    try {
      const { size } = await fd.stat();
      if (size === 0) return [];

      // Read from the tail, collecting raw buffers until we have enough
      // newlines. We decode only after concatenation so multibyte UTF-8
      // sequences split across chunk boundaries are handled correctly.
      const CHUNK = 64 * 1024; // 64KB
      let offset = size;
      const bufs: Buffer[] = [];
      let newlineCount = 0;

      while (offset > 0 && newlineCount <= n) {
        const chunkSize = Math.min(CHUNK, offset);
        offset -= chunkSize;
        const buf = Buffer.alloc(chunkSize);
        await fd.read(buf, 0, chunkSize, offset);
        bufs.unshift(buf);
        for (let i = 0; i < buf.length; i++) {
          if (buf[i] === 0x0a) newlineCount++;
        }
      }

      const text = Buffer.concat(bufs).toString("utf-8");
      const lines = text.split("\n").filter((l) => l.trim());
      return lines.slice(-n).map((l) => JSON.parse(l));
    } finally {
      await fd.close();
    }
  }

  subscribe(fn: (event: Event) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
