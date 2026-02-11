import fs from "node:fs/promises";

let iterationCount = 0;

export async function decidePatch(): Promise<{ summary: string; files: string[]; apply: () => Promise<void> }> {
  iterationCount++;

  // Every 3rd iteration, intentionally break the version check to test rollback
  const shouldBreak = iterationCount % 3 === 0;

  if (shouldBreak) {
    return {
      summary: "Break version for rollback test",
      files: ["src/shared/version.ts"],
      apply: async () => {
        await fs.writeFile("src/shared/version.ts", 'export const VERSION = "lol";\n', "utf-8");
      },
    };
  }

  // Normal iteration: append to diary
  const diaryPath = "self/diary.md";
  const timestamp = new Date().toISOString();

  return {
    summary: "Append iteration to diary",
    files: [diaryPath],
    apply: async () => {
      await fs.mkdir("self", { recursive: true });
      const entry = `## ${timestamp}\n\nIteration ${iterationCount} - System functioning normally.\n\n`;
      try {
        const existing = await fs.readFile(diaryPath, "utf-8");
        await fs.writeFile(diaryPath, existing + entry, "utf-8");
      } catch {
        await fs.writeFile(diaryPath, `# Diary\n\n${entry}`, "utf-8");
      }
    },
  };
}
