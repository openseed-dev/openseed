import { spawn } from 'node:child_process';
import {
  closeSync,
  openSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

let bashSeq = 0;

export async function executeBash(
  command: string,
  options: {
    cwd?: string;
    timeout?: number;
  } = {}
): Promise<BashResult> {
  const { cwd = process.cwd(), timeout = 120000 } = options;

  // Use temp files instead of pipes so background processes (nohup, &) don't
  // get SIGPIPE when the foreground bash exits and Node closes the pipe FDs.
  const id = `bash_${process.pid}_${++bashSeq}`;
  const outPath = join(tmpdir(), `${id}.out`);
  const errPath = join(tmpdir(), `${id}.err`);
  const outFd = openSync(outPath, "w");
  const errFd = openSync(errPath, "w");

  return new Promise((resolve) => {
    const proc = spawn("bash", ["-c", command], {
      cwd,
      // File FDs instead of pipes so background children inherit file descriptors
      // that stay valid even after we close our copies. No SIGPIPE.
      // detached creates a new session so /dev/tty is unavailable.
      stdio: ["ignore", outFd, errFd],
      detached: true,
      env: { ...process.env, ...NON_INTERACTIVE_ENV },
    });

    // Close our FD copies; the child has its own
    closeSync(outFd);
    closeSync(errFd);

    // Let Node's event loop ignore this child (background processes won't block exit)
    proc.unref();

    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      try { process.kill(-proc.pid!, "SIGKILL"); } catch {}
    }, timeout);

    const cleanup = (code: number | null) => {
      clearTimeout(timer);
      // Brief delay for file writes to flush
      setTimeout(() => {
        let stdout = "", stderr = "";
        try { stdout = readFileSync(outPath, "utf-8").trim(); } catch {}
        try { stderr = readFileSync(errPath, "utf-8").trim(); } catch {}
        try { unlinkSync(outPath); } catch {}
        try { unlinkSync(errPath); } catch {}
        resolve({
          stdout,
          stderr: killed ? `${stderr}\n[killed: timeout after ${timeout}ms]`.trim() : stderr,
          exitCode: code ?? 1,
          timedOut: killed,
        });
      }, 200);
    };

    // Use 'exit' not 'close' because with file-based stdio there are no pipe streams
    // to drain, and 'exit' fires as soon as the foreground bash exits.
    // This clears the timeout immediately, so background processes in the same
    // process group aren't killed by the 120s timer.
    proc.on("exit", (code) => cleanup(code));

    proc.on("error", (err) => {
      clearTimeout(timer);
      try { unlinkSync(outPath); } catch {}
      try { unlinkSync(errPath); } catch {}
      resolve({ stdout: "", stderr: err.message, exitCode: 1 });
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

Commands time out after 120s by default. You have no terminal, so interactive prompts (sudo, ssh password, etc.) will fail immediately.

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
        description: "Timeout in milliseconds (default: 120000)",
      },
    },
    required: ["command"],
  },
};
