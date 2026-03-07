import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { EventStore } from "./events.js";

describe("EventStore.readRecent", () => {
  let tmpDir: string;
  let store: EventStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "eventstore-"));
    store = new EventStore(tmpDir);
    await store.init();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array for empty file", async () => {
    const events = await store.readRecent(10);
    expect(events).toEqual([]);
  });

  it("returns all events when fewer than N exist", async () => {
    for (let i = 0; i < 3; i++) {
      await store.append({
        t: new Date().toISOString(),
        type: "creature.thought",
        text: `thought-${i}`,
      });
    }
    const events = await store.readRecent(10);
    expect(events).toHaveLength(3);
    expect(events[0].type).toBe("creature.thought");
    expect((events[0] as { text: string }).text).toBe("thought-0");
    expect((events[2] as { text: string }).text).toBe("thought-2");
  });

  it("returns only last N events when more exist", async () => {
    for (let i = 0; i < 20; i++) {
      await store.append({
        t: new Date().toISOString(),
        type: "creature.thought",
        text: `thought-${i}`,
      });
    }
    const events = await store.readRecent(5);
    expect(events).toHaveLength(5);
    expect((events[0] as { text: string }).text).toBe("thought-15");
    expect((events[4] as { text: string }).text).toBe("thought-19");
  });

  it("handles exactly N events", async () => {
    for (let i = 0; i < 5; i++) {
      await store.append({
        t: new Date().toISOString(),
        type: "creature.thought",
        text: `thought-${i}`,
      });
    }
    const events = await store.readRecent(5);
    expect(events).toHaveLength(5);
    expect((events[0] as { text: string }).text).toBe("thought-0");
  });

  it("readAll still works for backward compat", async () => {
    for (let i = 0; i < 3; i++) {
      await store.append({
        t: new Date().toISOString(),
        type: "creature.thought",
        text: `thought-${i}`,
      });
    }
    const events = await store.readAll();
    expect(events).toHaveLength(3);
  });

  it("handles many events spanning multiple chunks", async () => {
    // Write enough events to exceed a single 64KB chunk
    const longText = "x".repeat(500);
    for (let i = 0; i < 200; i++) {
      await store.append({
        t: new Date().toISOString(),
        type: "creature.thought",
        text: `${longText}-${i}`,
      });
    }
    const events = await store.readRecent(50);
    expect(events).toHaveLength(50);
    expect((events[0] as { text: string }).text).toContain("-150");
    expect((events[49] as { text: string }).text).toContain("-199");
  });
});
