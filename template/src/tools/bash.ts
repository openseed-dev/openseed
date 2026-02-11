import { spawn } from "node:child_process";

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function executeBash(
  command: string,
  options: {
    cwd?: string;
    timeout?: number;
  } = {}
): Promise<BashResult> {
  const { cwd = process.cwd(), timeout = 30000 } = options;

  return new Promise((resolve) => {
    const proc = spawn("bash", ["-c", command], {
      cwd,
      timeout,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 1,
      });
    });

    proc.on("error", (err) => {
      resolve({
        stdout: "",
        stderr: err.message,
        exitCode: 1,
      });
    });
  });
}

export const bashTool = {
  name: "bash",
  description: `Execute a bash command. Use this to interact with the system and the world.

You can:
- Run git commands: git status, git diff, git log
- Make HTTP requests: curl https://api.example.com
- Read/write files: cat, echo, etc. (but prefer using file operations directly)
- Run scripts: node script.js
- Any other CLI tool available

Examples:
- Check git status: git status
- Fetch data: curl -s https://api.github.com/zen
- List files: ls -la
- Get system info: uname -a`,
  input_schema: {
    type: "object" as const,
    properties: {
      command: {
        type: "string",
        description: "The bash command to execute",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default: 30000)",
      },
    },
    required: ["command"],
  },
};
