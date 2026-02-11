import { spawn } from "node:child_process";

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
}

// Suppress interactive prompts in child processes
const NON_INTERACTIVE_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  DEBIAN_FRONTEND: "noninteractive",
  GCM_INTERACTIVE: "never",
  SSH_BATCH_MODE: "yes",
};

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
      env: { ...process.env, ...NON_INTERACTIVE_ENV },
    });

    // Close stdin immediately — no interactive input ever
    proc.stdin.end();

    let stdout = "";
    let stderr = "";
    let killed = false;

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGKILL");
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: stdout.trim(),
        stderr: killed ? `${stderr.trim()}\n[killed: timeout after ${timeout}ms]`.trim() : stderr.trim(),
        exitCode: code ?? 1,
        timedOut: killed,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
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

Commands time out after 30s by default. Interactive prompts (sudo, ssh, etc.) will fail immediately — you have no tty.

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
