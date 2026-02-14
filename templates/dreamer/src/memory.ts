import fs from "node:fs/promises";

const MEMORY_DIR = ".self";
const MEMORY_FILE = `${MEMORY_DIR}/memory.jsonl`;

export interface MemoryRecord {
  t: string;
  type: "thought" | "action" | "observation" | "self_change" | "heartbeat";
  data: Record<string, unknown>;
}

export class Memory {
  async init(): Promise<void> {
    await fs.mkdir(MEMORY_DIR, { recursive: true });
  }

  async append(type: MemoryRecord["type"], data: Record<string, unknown>): Promise<void> {
    const record: MemoryRecord = {
      t: new Date().toISOString(),
      type,
      data,
    };

    await fs.appendFile(MEMORY_FILE, JSON.stringify(record) + "\n", "utf-8");
  }
}
