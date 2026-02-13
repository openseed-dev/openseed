import { execSync } from 'node:child_process';

const POLL_INTERVAL_MS = 60_000; // check every 60s
const GITHUB_CHECK_SCRIPT = `python3 -c "
import subprocess, json, hashlib
try:
    r = subprocess.run(['gh', 'api', 'notifications', '--jq', '.[].id'], capture_output=True, text=True, timeout=15)
    print(hashlib.md5(r.stdout.encode()).hexdigest() if r.returncode == 0 else 'error')
except: print('error')
"`;

export interface WatchCondition {
  creature: string;
  container: string;
  conditions: string[];
}

interface WatchState {
  lastHash: Map<string, string>;
}

export class Watcher {
  private watches: Map<string, WatchCondition> = new Map();
  private state: Map<string, WatchState> = new Map();
  private interval: ReturnType<typeof setInterval> | null = null;
  private onWake: (creature: string, reason: string) => Promise<void>;

  constructor(onWake: (creature: string, reason: string) => Promise<void>) {
    this.onWake = onWake;
  }

  addWatch(creature: string, container: string, conditions: string[]) {
    this.watches.set(creature, { creature, container, conditions });
    if (!this.state.has(creature)) {
      this.state.set(creature, { lastHash: new Map() });
    }

    // Seed initial state so first poll doesn't immediately trigger
    for (const cond of conditions) {
      const hash = this.checkCondition(container, cond);
      if (hash && hash !== 'error') {
        this.state.get(creature)!.lastHash.set(cond, hash);
      }
    }

    console.log(`[watcher] watching ${creature} for: ${conditions.join(', ')}`);

    if (!this.interval) {
      this.interval = setInterval(() => this.poll(), POLL_INTERVAL_MS);
    }
  }

  removeWatch(creature: string) {
    this.watches.delete(creature);
    this.state.delete(creature);
    console.log(`[watcher] removed watch for ${creature}`);

    if (this.watches.size === 0 && this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.watches.clear();
    this.state.clear();
  }

  private async poll() {
    for (const [creature, watch] of this.watches) {
      const st = this.state.get(creature)!;
      for (const cond of watch.conditions) {
        const hash = this.checkCondition(watch.container, cond);
        if (!hash || hash === 'error') continue;

        const prev = st.lastHash.get(cond);
        if (prev && prev !== hash) {
          console.log(`[watcher] ${creature}: condition "${cond}" changed`);
          st.lastHash.set(cond, hash);
          this.removeWatch(creature);
          await this.onWake(creature, `Watch condition fired: ${cond}`);
          return; // One wake at a time
        }
        st.lastHash.set(cond, hash);
      }
    }
  }

  private checkCondition(container: string, condition: string): string | null {
    try {
      let script: string;
      if (condition === 'github_notifications') {
        script = GITHUB_CHECK_SCRIPT;
      } else {
        // Custom script: run it and hash the output
        script = `hash=$(${condition} 2>/dev/null | md5sum | cut -d' ' -f1) && echo $hash`;
      }
      const output = execSync(`docker exec ${container} bash -c ${JSON.stringify(script)}`, {
        encoding: 'utf-8',
        timeout: 20_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return output || null;
    } catch {
      return null;
    }
  }
}
