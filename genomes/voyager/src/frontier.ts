import fs from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const FRONTIER_FILE = ".self/frontier.jsonl";

export type TaskStatus = "pending" | "active" | "completed" | "abandoned";

export interface FrontierTask {
  id: string;
  task: string;
  criteria: string;
  status: TaskStatus;
  difficulty: number;
  proposed: string;
  attempts: number;
  lastAttempt?: string;
  skills_produced?: string[];
}

export async function loadFrontier(): Promise<FrontierTask[]> {
  try {
    const raw = await fs.readFile(FRONTIER_FILE, "utf-8");
    return raw.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

async function writeFrontier(tasks: FrontierTask[]): Promise<void> {
  await fs.writeFile(FRONTIER_FILE, tasks.map(t => JSON.stringify(t)).join("\n") + "\n", "utf-8");
}

export async function selectTask(): Promise<FrontierTask | null> {
  const tasks = await loadFrontier();
  const pending = tasks.filter(t => t.status === "pending");
  if (pending.length === 0) return null;

  // Prefer: lowest difficulty first, then fewest attempts, then oldest
  pending.sort((a, b) =>
    a.difficulty - b.difficulty
    || a.attempts - b.attempts
    || new Date(a.proposed).getTime() - new Date(b.proposed).getTime()
  );

  return pending[0];
}

export async function proposeTask(task: string, criteria: string, difficulty = 1): Promise<FrontierTask> {
  const entry: FrontierTask = {
    id: randomUUID().slice(0, 8),
    task,
    criteria,
    status: "pending",
    difficulty,
    proposed: new Date().toISOString(),
    attempts: 0,
  };
  appendFileSync(FRONTIER_FILE, JSON.stringify(entry) + "\n", "utf-8");
  return entry;
}

export async function updateTask(
  id: string,
  updates: Partial<Pick<FrontierTask, "status" | "attempts" | "lastAttempt" | "skills_produced">>,
): Promise<void> {
  const tasks = await loadFrontier();
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  Object.assign(task, updates);
  await writeFrontier(tasks);
}

export async function frontierSummary(): Promise<string> {
  const tasks = await loadFrontier();
  if (tasks.length === 0) return "Your frontier is empty. Propose tasks based on your purpose!";

  const pending = tasks.filter(t => t.status === "pending");
  const completed = tasks.filter(t => t.status === "completed");
  const abandoned = tasks.filter(t => t.status === "abandoned");

  let summary = `Frontier: ${pending.length} pending, ${completed.length} completed, ${abandoned.length} abandoned\n`;

  if (pending.length > 0) {
    summary += "\nPending tasks:\n";
    for (const t of pending.slice(0, 10)) {
      summary += `  [${t.id}] (d=${t.difficulty}) ${t.task}${t.attempts > 0 ? ` (${t.attempts} prior attempts)` : ""}\n`;
    }
  }

  if (completed.length > 0) {
    const recent = completed.slice(-5);
    summary += "\nRecently completed:\n";
    for (const t of recent) {
      summary += `  [${t.id}] ${t.task}${t.skills_produced?.length ? ` → skills: ${t.skills_produced.join(", ")}` : ""}\n`;
    }
  }

  return summary;
}
