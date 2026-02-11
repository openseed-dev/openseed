export type Event =
  | { t: string; type: "host.boot" }
  | { t: string; type: "host.spawn"; pid: number; sha: string }
  | { t: string; type: "host.promote"; sha: string }
  | { t: string; type: "host.rollback"; from: string; to: string; reason: string }
  | { t: string; type: "creature.boot"; sha: string }
  | { t: string; type: "creature.proposal"; text: string }
  | { t: string; type: "creature.intent"; text: string; critiqued: boolean }
  | { t: string; type: "creature.tool_call"; tool: string; input: string; ok: boolean; output: string; ms: number }
  | { t: string; type: "creature.patch"; summary: string; files: string[] }
  | { t: string; type: "creature.checks"; cmd: string; ok: boolean; ms: number; out_tail?: string }
  | { t: string; type: "creature.request_restart"; sha: string };

export interface HostStatus {
  current_sha: string;
  last_good_sha: string;
  pid: number | null;
  healthy: boolean;
}
