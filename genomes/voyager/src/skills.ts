import fs from 'node:fs/promises';
import { appendFileSync, mkdirSync } from 'node:fs';

const SKILLS_DIR = ".self/skills";
const INDEX_FILE = ".self/skills/index.jsonl";

export interface Skill {
  name: string;
  desc: string;
  tags: string[];
  path: string;
  lang: string;
  verified: string;
  attempts: number;
  successes: number;
}

function ensureDir() {
  mkdirSync(SKILLS_DIR, { recursive: true });
}

export async function listSkills(): Promise<Skill[]> {
  try {
    const raw = await fs.readFile(INDEX_FILE, "utf-8");
    return raw.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

export async function searchSkills(query: string): Promise<Skill[]> {
  const skills = await listSkills();
  const terms = query.toLowerCase().split(/\s+/);
  return skills.filter(s => {
    const haystack = `${s.name} ${s.desc} ${s.tags.join(" ")}`.toLowerCase();
    return terms.some(t => haystack.includes(t));
  });
}

export async function getSkillCode(name: string): Promise<string | null> {
  const skills = await listSkills();
  const skill = skills.find(s => s.name === name);
  if (!skill) return null;
  try {
    return await fs.readFile(skill.path, "utf-8");
  } catch {
    return null;
  }
}

const LANG_EXT: Record<string, string> = { bash: "sh", python: "py", node: "js" };

export async function commitSkill(
  name: string,
  desc: string,
  tags: string[],
  code: string,
  lang: string,
  verification: string,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  ensureDir();

  const ext = LANG_EXT[lang] || lang;
  const filePath = `${SKILLS_DIR}/${name}.${ext}`;
  const now = new Date().toISOString();

  const header = lang === "bash"
    ? `#!/bin/bash\n# @name: ${name}\n# @desc: ${desc}\n# @tags: ${tags.join(", ")}\n# @verified: ${now}\n`
    : lang === "python"
    ? `#!/usr/bin/env python3\n# @name: ${name}\n# @desc: ${desc}\n# @tags: ${tags.join(", ")}\n# @verified: ${now}\n`
    : `// @name: ${name}\n// @desc: ${desc}\n// @tags: ${tags.join(", ")}\n// @verified: ${now}\n`;

  const fullCode = code.startsWith("#!") ? code : header + code;

  try {
    await fs.writeFile(filePath, fullCode, "utf-8");
    await fs.chmod(filePath, 0o755);
  } catch (err) {
    return { ok: false, error: `Failed to write skill file: ${err}` };
  }

  // Update or append to index
  const existing = await listSkills();
  const prev = existing.find(s => s.name === name);
  const entry: Skill = {
    name,
    desc,
    tags,
    path: filePath,
    lang,
    verified: now,
    attempts: (prev?.attempts ?? 0) + 1,
    successes: (prev?.successes ?? 0) + 1,
  };

  if (prev) {
    const lines = existing.map(s => JSON.stringify(s.name === name ? entry : s));
    await fs.writeFile(INDEX_FILE, lines.join("\n") + "\n", "utf-8");
  } else {
    appendFileSync(INDEX_FILE, JSON.stringify(entry) + "\n", "utf-8");
  }

  return { ok: true, path: filePath };
}

export async function recordAttempt(name: string, success: boolean): Promise<void> {
  const skills = await listSkills();
  const skill = skills.find(s => s.name === name);
  if (!skill) return;

  skill.attempts++;
  if (success) skill.successes++;

  const lines = skills.map(s => JSON.stringify(s));
  await fs.writeFile(INDEX_FILE, lines.join("\n") + "\n", "utf-8");
}

export async function skillInventory(): Promise<string> {
  const skills = await listSkills();
  if (skills.length === 0) return "Your skill library is empty. Build your first skill!";

  const lines = skills.map(s =>
    `- ${s.name}: ${s.desc} [${s.lang}] (${s.successes}/${s.attempts} success rate)`
  );
  return `Your skill library (${skills.length} skills):\n${lines.join("\n")}`;
}

export async function getRelevantSkillSources(query: string, limit = 3): Promise<string> {
  const matches = await searchSkills(query);
  if (matches.length === 0) return "";

  const sections: string[] = [];
  for (const skill of matches.slice(0, limit)) {
    const code = await getSkillCode(skill.name);
    if (code) {
      sections.push(`### ${skill.name} (${skill.lang})\n${skill.desc}\n\`\`\`\n${code}\n\`\`\``);
    }
  }
  return sections.length > 0
    ? `Relevant skills for this task:\n\n${sections.join("\n\n")}`
    : "";
}
