import fs from "node:fs/promises";
import path from "node:path";

const MEMORY_DIR = ".self";
const MEMORY_FILE = `${MEMORY_DIR}/memory.jsonl`;
const SNAPSHOTS_DIR = `${MEMORY_DIR}/snapshots`;
const SNAPSHOT_INTERVAL = 50;
const CONTEXT_WINDOW = 50;

export interface MemoryRecord {
  t: string;
  type: "thought" | "action" | "observation" | "self_change" | "heartbeat" | "snapshot";
  data: Record<string, unknown>;
}

export interface SnapshotData {
  identity: string;
  attractors: string[];
  recent_actions: string[];
  open_threads: string[];
  self_mod_history: string[];
  created_at: string;
  thought_count: number;
}

export class Memory {
  private thoughtCount = 0;

  async init(): Promise<void> {
    await fs.mkdir(MEMORY_DIR, { recursive: true });
    await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
  }

  async append(type: MemoryRecord["type"], data: Record<string, unknown>): Promise<void> {
    const record: MemoryRecord = {
      t: new Date().toISOString(),
      type,
      data,
    };

    await fs.appendFile(MEMORY_FILE, JSON.stringify(record) + "\n", "utf-8");

    if (type === "thought") {
      this.thoughtCount++;
      if (this.thoughtCount % SNAPSHOT_INTERVAL === 0) {
        await this.append("snapshot", { thought_count: this.thoughtCount });
      }
    }
  }

  async loadContext(): Promise<{ snapshot: SnapshotData | null; recentMemory: MemoryRecord[] }> {
    const snapshot = await this.loadLastSnapshot();
    const recentMemory = await this.loadRecentMemory(CONTEXT_WINDOW);

    return { snapshot, recentMemory };
  }

  private async loadLastSnapshot(): Promise<SnapshotData | null> {
    try {
      const files = await fs.readdir(SNAPSHOTS_DIR);
      const snapshotFiles = files.filter((f) => f.endsWith(".json")).sort().reverse();

      if (snapshotFiles.length === 0) {
        return null;
      }

      const latestFile = path.join(SNAPSHOTS_DIR, snapshotFiles[0]);
      const content = await fs.readFile(latestFile, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private async loadRecentMemory(limit: number): Promise<MemoryRecord[]> {
    try {
      const content = await fs.readFile(MEMORY_FILE, "utf-8");
      const lines = content.trim().split("\n").filter((l) => l);
      const records = lines.slice(-limit).map((line) => JSON.parse(line));
      return records;
    } catch {
      return [];
    }
  }

  async createSnapshot(data: SnapshotData): Promise<void> {
    const timestamp = Date.now();
    const filename = `${timestamp}.json`;
    const filepath = path.join(SNAPSHOTS_DIR, filename);

    await fs.writeFile(filepath, JSON.stringify(data, null, 2), "utf-8");
  }
}
