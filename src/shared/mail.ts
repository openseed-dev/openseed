/**
 * Minimal mailbox system for inter-creature communication.
 *
 * Layout:
 *   ~/.openseed/mail/{creature}/inbox/{id}.json
 *   ~/.openseed/mail/{creature}/sent/{id}.json
 *
 * Each message file contains a MailMessage JSON object.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/** Validates a creature name. Rejects path traversal and weird chars. */
const VALID_NAME = /^[a-z0-9][a-z0-9-]*$/;

export function validateCreatureName(name: string): void {
  if (!VALID_NAME.test(name)) {
    throw new Error(`invalid creature name: "${name}"`);
  }
}

export interface MailMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  timestamp: string;
  read: boolean;
}

/** Ensure inbox/ and sent/ dirs exist for a creature. */
export async function ensureMailbox(
  mailDir: string,
  creature: string,
): Promise<void> {
  validateCreatureName(creature);
  const base = path.join(mailDir, creature);
  await fs.mkdir(path.join(base, "inbox"), { recursive: true });
  await fs.mkdir(path.join(base, "sent"), { recursive: true });
  await fs.mkdir(path.join(base, "archived"), { recursive: true });
}

/** Send a message from one creature to another. */
export async function sendMessage(
  mailDir: string,
  from: string,
  to: string,
  subject: string,
  body: string,
): Promise<MailMessage> {
  validateCreatureName(from);
  validateCreatureName(to);

  const msg: MailMessage = {
    id: crypto.randomUUID(),
    from,
    to,
    subject,
    body,
    timestamp: new Date().toISOString(),
    read: false,
  };

  // Ensure both mailboxes exist
  await ensureMailbox(mailDir, from);
  await ensureMailbox(mailDir, to);

  const data = JSON.stringify(msg, null, 2);

  // Write to recipient's inbox and sender's sent
  await fs.writeFile(path.join(mailDir, to, "inbox", `${msg.id}.json`), data);
  await fs.writeFile(path.join(mailDir, from, "sent", `${msg.id}.json`), data);

  return msg;
}

/** Read a creature's inbox. Returns messages sorted newest-first. */
export async function readInbox(
  mailDir: string,
  creature: string,
): Promise<{ total: number; unread: number; messages: MailMessage[] }> {
  validateCreatureName(creature);
  const inboxDir = path.join(mailDir, creature, "inbox");
  const files = await fs.readdir(inboxDir).catch(() => []);

  const messages: MailMessage[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(inboxDir, file), "utf-8");
      messages.push(JSON.parse(raw));
    } catch {
      // Skip corrupt files
    }
  }

  messages.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return {
    total: messages.length,
    unread: messages.filter((m) => !m.read).length,
    messages,
  };
}

/** Mark specific messages as read. */
export async function markRead(
  mailDir: string,
  creature: string,
  ids: string[],
): Promise<number> {
  validateCreatureName(creature);
  const inboxDir = path.join(mailDir, creature, "inbox");
  let marked = 0;

  for (const id of ids) {
    // Validate ID format (UUID)
    if (!/^[a-f0-9-]{36}$/.test(id)) continue;
    const filePath = path.join(inboxDir, `${id}.json`);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const msg: MailMessage = JSON.parse(raw);
      if (!msg.read) {
        msg.read = true;
        await fs.writeFile(filePath, JSON.stringify(msg, null, 2));
        marked++;
      }
    } catch {
      // File doesn't exist or is corrupt
    }
  }

  return marked;
}

/** Move messages from inbox to archived. */
export async function archiveMessages(
  mailDir: string,
  creature: string,
  ids: string[],
): Promise<number> {
  validateCreatureName(creature);
  const inboxDir = path.join(mailDir, creature, "inbox");
  const archiveDir = path.join(mailDir, creature, "archived");
  await fs.mkdir(archiveDir, { recursive: true });
  let archived = 0;

  for (const id of ids) {
    if (!/^[a-f0-9-]{36}$/.test(id)) continue;
    const src = path.join(inboxDir, `${id}.json`);
    const dest = path.join(archiveDir, `${id}.json`);
    try {
      await fs.rename(src, dest);
      archived++;
    } catch {
      // File doesn't exist or already archived
    }
  }

  return archived;
}

/** List all mailboxes with unread counts. */
export async function listMailboxes(
  mailDir: string,
): Promise<Array<{ creature: string; total: number; unread: number }>> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(mailDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: Array<{ creature: string; total: number; unread: number }> =
    [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!VALID_NAME.test(entry.name)) continue;
    const { total, unread } = await readInbox(mailDir, entry.name);
    results.push({ creature: entry.name, total, unread });
  }

  return results;
}
