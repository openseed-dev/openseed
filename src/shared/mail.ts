import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

const VALID_NAME = /^[a-z0-9][a-z0-9-]*$/;

export function validateCreatureName(name: string): void {
  if (!VALID_NAME.test(name)) {
    throw new Error(`invalid creature name: "${name}"`);
  }
}

export interface MailMessage {
  id: string;
  owner: string;
  folder: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  timestamp: string;
  read: boolean;
  flagged: boolean;
  tags: string[];
  triage_note: string;
}

let db: Database.Database | null = null;

export function initMail(dbPath: string): void {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS mail (
      id TEXT NOT NULL,
      owner TEXT NOT NULL,
      folder TEXT NOT NULL DEFAULT 'inbox',
      from_creature TEXT NOT NULL,
      to_creature TEXT NOT NULL,
      subject TEXT DEFAULT '',
      body TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      read INTEGER DEFAULT 0,
      flagged INTEGER DEFAULT 0,
      tags TEXT DEFAULT '[]',
      triage_note TEXT DEFAULT '',
      PRIMARY KEY (id, owner)
    );
    CREATE INDEX IF NOT EXISTS idx_mail_owner_folder ON mail(owner, folder);
    CREATE INDEX IF NOT EXISTS idx_mail_owner_unread ON mail(owner, read) WHERE folder = 'inbox';
    CREATE INDEX IF NOT EXISTS idx_mail_timestamp ON mail(timestamp);
  `);
}

function getDb(): Database.Database {
  if (!db) throw new Error('Mail not initialized — call initMail() first');
  return db;
}

function rowToMessage(row: any): MailMessage {
  return {
    id: row.id,
    owner: row.owner,
    folder: row.folder,
    from: row.from_creature,
    to: row.to_creature,
    subject: row.subject,
    body: row.body,
    timestamp: row.timestamp,
    read: !!row.read,
    flagged: !!row.flagged,
    tags: JSON.parse(row.tags || '[]'),
    triage_note: row.triage_note || '',
  };
}

export function sendMessage(
  from: string,
  to: string,
  subject: string,
  body: string,
): MailMessage {
  validateCreatureName(from);
  validateCreatureName(to);
  if (from === to) throw new Error('a creature cannot send mail to itself');

  const d = getDb();
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  const insert = d.prepare(`
    INSERT INTO mail (id, owner, folder, from_creature, to_creature, subject, body, timestamp, read)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  d.transaction(() => {
    insert.run(id, to, 'inbox', from, to, subject, body, timestamp, 0);
    insert.run(id, from, 'sent', from, to, subject, body, timestamp, 1);
  })();

  return {
    id, owner: to, folder: 'inbox',
    from, to, subject, body, timestamp,
    read: false, flagged: false, tags: [], triage_note: '',
  };
}

export interface ListMailOpts {
  folder?: string;
  unread?: boolean;
  limit?: number;
  offset?: number;
}

export function listMessages(
  owner: string,
  opts: ListMailOpts = {},
): { total: number; unread: number; messages: MailMessage[] } {
  validateCreatureName(owner);
  const d = getDb();
  const folder = opts.folder || 'inbox';
  const limit = Math.min(opts.limit || 50, 200);
  const offset = opts.offset || 0;

  let sql = 'SELECT * FROM mail WHERE owner = ? AND folder = ?';
  const params: any[] = [owner, folder];

  if (opts.unread) {
    sql += ' AND read = 0';
  }

  sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const messages = d.prepare(sql).all(...params).map(rowToMessage);

  const counts = d.prepare(
    'SELECT COUNT(*) as total, SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) as unread FROM mail WHERE owner = ? AND folder = ?'
  ).get(owner, folder) as any;

  return {
    total: counts.total,
    unread: counts.unread || 0,
    messages,
  };
}

export function getMessage(owner: string, id: string): MailMessage | null {
  validateCreatureName(owner);
  const d = getDb();
  const row = d.prepare('SELECT * FROM mail WHERE id = ? AND owner = ?').get(id, owner) as any;
  return row ? rowToMessage(row) : null;
}

export function markRead(owner: string, ids: string[]): number {
  validateCreatureName(owner);
  const d = getDb();
  const stmt = d.prepare('UPDATE mail SET read = 1 WHERE id = ? AND owner = ? AND read = 0');
  let marked = 0;
  d.transaction(() => {
    for (const id of ids) {
      marked += stmt.run(id, owner).changes;
    }
  })();
  return marked;
}

export function archiveMessages(owner: string, ids: string[]): number {
  validateCreatureName(owner);
  const d = getDb();
  const stmt = d.prepare("UPDATE mail SET folder = 'archived' WHERE id = ? AND owner = ? AND folder = 'inbox'");
  let count = 0;
  d.transaction(() => {
    for (const id of ids) {
      count += stmt.run(id, owner).changes;
    }
  })();
  return count;
}

export function unarchiveMessages(owner: string, ids: string[]): number {
  validateCreatureName(owner);
  const d = getDb();
  const stmt = d.prepare("UPDATE mail SET folder = 'inbox' WHERE id = ? AND owner = ? AND folder = 'archived'");
  let count = 0;
  d.transaction(() => {
    for (const id of ids) {
      count += stmt.run(id, owner).changes;
    }
  })();
  return count;
}

export function flagMessage(owner: string, id: string, flagged: boolean): boolean {
  validateCreatureName(owner);
  const d = getDb();
  const changes = d.prepare('UPDATE mail SET flagged = ? WHERE id = ? AND owner = ?').run(flagged ? 1 : 0, id, owner).changes;
  return changes > 0;
}

export function tagMessage(owner: string, id: string, tags: string[]): boolean {
  validateCreatureName(owner);
  const d = getDb();
  const changes = d.prepare('UPDATE mail SET tags = ? WHERE id = ? AND owner = ?').run(JSON.stringify(tags), id, owner).changes;
  return changes > 0;
}

export function setTriageNote(owner: string, id: string, note: string): boolean {
  validateCreatureName(owner);
  const d = getDb();
  const changes = d.prepare('UPDATE mail SET triage_note = ? WHERE id = ? AND owner = ?').run(note, id, owner).changes;
  return changes > 0;
}

export function listMailboxes(): Array<{ creature: string; total: number; unread: number }> {
  const d = getDb();
  const rows = d.prepare(`
    SELECT owner,
      COUNT(*) as total,
      SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) as unread
    FROM mail WHERE folder = 'inbox'
    GROUP BY owner
    ORDER BY owner
  `).all() as any[];
  return rows.map(r => ({ creature: r.owner, total: r.total, unread: r.unread || 0 }));
}

// --- Filesystem migration ---

function normalizeTimestamp(obj: any, filename: string): string {
  if (obj.timestamp) return new Date(obj.timestamp).toISOString();
  if (obj.date) return new Date(obj.date).toISOString();
  if (obj.ts) return new Date(obj.ts).toISOString();

  // Epoch prefix in filename: "1772887391-uuid.json"
  const epochMatch = filename.match(/^(\d{10,})-/);
  if (epochMatch) return new Date(parseInt(epochMatch[1]) * 1000).toISOString();

  // ISO date in filename: "2026-03-11T08:01:20+00:00-..."
  const isoMatch = filename.match(/^(\d{4}-\d{2}-\d{2}T[\d:+]+)/);
  if (isoMatch) return new Date(isoMatch[1]).toISOString();

  return new Date().toISOString();
}

function migrateStandardFolder(
  insert: Database.Statement,
  creatureName: string,
  folderPath: string,
  folder: string,
): number {
  if (!fs.existsSync(folderPath)) return 0;
  let count = 0;
  const files = fs.readdirSync(folderPath);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const filePath = path.join(folderPath, file);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      const raw = fs.readFileSync(filePath, 'utf-8');
      const obj = JSON.parse(raw);

      const id = obj.id || crypto.randomUUID();
      const from = obj.from || 'unknown';
      const to = obj.to || creatureName;
      const subject = obj.subject || '';
      const body = obj.body || '';
      const timestamp = normalizeTimestamp(obj, file);
      const read = obj.read ? 1 : 0;
      const flagged = obj.flagged ? 1 : 0;
      const tags = obj.tags ? JSON.stringify(obj.tags) : '[]';
      const triage_note = obj.triage_note || '';

      // owner is the creature whose mailbox dir this is
      insert.run(id, creatureName, folder, from, to, subject, body, timestamp, read, flagged, tags, triage_note);
      count++;
    } catch { /* skip corrupt files */ }
  }
  return count;
}

function migrateSubdirectoryMail(
  insert: Database.Statement,
  creatureName: string,
  subDir: string,
  recipientName: string,
): number {
  if (!fs.existsSync(subDir)) return 0;
  let count = 0;
  const files = fs.readdirSync(subDir);

  for (const file of files) {
    const filePath = path.join(subDir, file);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;

      if (file.endsWith('.json')) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const obj = JSON.parse(raw);
        const id = obj.id || crypto.randomUUID();
        const from = obj.from || creatureName;
        const to = obj.to || recipientName;
        const subject = obj.subject || '';
        const body = obj.body || '';
        const timestamp = normalizeTimestamp(obj, file);
        const read = obj.read ? 1 : 0;

        insert.run(id, creatureName, 'sent', from, to, subject, body, timestamp, read, 0, '[]', '');
        count++;
      } else if (file.endsWith('.md')) {
        // Legacy markdown: "2026-03-11T08:01:20+00:00-proof-ops-to-proof-ceo.md"
        const body = fs.readFileSync(filePath, 'utf-8');
        const id = crypto.randomUUID();
        const timestamp = normalizeTimestamp({}, file);

        insert.run(id, creatureName, 'sent', creatureName, recipientName, '', body.trim(), timestamp, 1, 0, '[]', '');
        count++;
      }
    } catch { /* skip */ }
  }
  return count;
}

function migrateRootMarkdownFiles(
  insert: Database.Statement,
  creatureName: string,
  creatureMailDir: string,
): number {
  let count = 0;
  const entries = fs.readdirSync(creatureMailDir);
  for (const file of entries) {
    if (!file.endsWith('.md')) continue;
    const filePath = path.join(creatureMailDir, file);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      const body = fs.readFileSync(filePath, 'utf-8');
      const id = crypto.randomUUID();
      const timestamp = normalizeTimestamp({}, file);

      insert.run(id, creatureName, 'sent', creatureName, 'unknown', '', body.trim(), timestamp, 1, 0, '[]', '');
      count++;
    } catch { /* skip */ }
  }
  return count;
}

export async function migrateFromFilesystem(mailDir: string): Promise<number> {
  const d = getDb();
  if (!fs.existsSync(mailDir)) return 0;

  const existing = (d.prepare('SELECT COUNT(*) as c FROM mail').get() as any).c;
  if (existing > 0) return 0;

  const insert = d.prepare(`
    INSERT OR IGNORE INTO mail (id, owner, folder, from_creature, to_creature, subject, body, timestamp, read, flagged, tags, triage_note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const creatures = fs.readdirSync(mailDir, { withFileTypes: true });
  let total = 0;

  const run = d.transaction(() => {
    for (const entry of creatures) {
      if (!entry.isDirectory()) continue;
      if (!VALID_NAME.test(entry.name)) continue;
      const creatureName = entry.name;
      const creatureMailDir = path.join(mailDir, creatureName);

      // Standard folders
      total += migrateStandardFolder(insert, creatureName, path.join(creatureMailDir, 'inbox'), 'inbox');
      total += migrateStandardFolder(insert, creatureName, path.join(creatureMailDir, 'sent'), 'sent');
      total += migrateStandardFolder(insert, creatureName, path.join(creatureMailDir, 'archived'), 'archived');
      total += migrateStandardFolder(insert, creatureName, path.join(creatureMailDir, 'archive'), 'archived');
      total += migrateStandardFolder(insert, creatureName, path.join(creatureMailDir, 'outbox'), 'sent');

      // proof-ops style sub-directories (per-recipient folders)
      const subdirs = fs.readdirSync(creatureMailDir, { withFileTypes: true });
      for (const sub of subdirs) {
        if (!sub.isDirectory()) continue;
        if (['inbox', 'sent', 'archived', 'archive', 'outbox'].includes(sub.name)) continue;
        if (!VALID_NAME.test(sub.name)) continue;
        total += migrateSubdirectoryMail(insert, creatureName, path.join(creatureMailDir, sub.name), sub.name);
      }

      // Root-level .md files
      total += migrateRootMarkdownFiles(insert, creatureName, creatureMailDir);
    }
  });

  run();
  return total;
}
