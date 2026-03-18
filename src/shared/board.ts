import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import Database from 'better-sqlite3';

export interface BoardPost {
  id: string;
  author: string;
  title: string;
  body: string;
  tags: string[];
  created_at: string;
  parent_id: string | null;
  reply_count?: number;
}

let db: Database.Database | null = null;

export function initBoard(dbPath: string): void {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      author TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      parent_id TEXT,
      FOREIGN KEY (parent_id) REFERENCES posts(id)
    );
    CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);
    CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author);
    CREATE INDEX IF NOT EXISTS idx_posts_parent ON posts(parent_id);
  `);
}

function getDb(): Database.Database {
  if (!db) throw new Error('Board not initialized — call initBoard() first');
  return db;
}

export function createPost(
  author: string,
  title: string,
  body: string,
  tags: string[] = [],
  parentId?: string | null,
): BoardPost {
  const d = getDb();
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();

  if (parentId) {
    const parent = d.prepare('SELECT id FROM posts WHERE id = ?').get(parentId);
    if (!parent) throw new Error(`parent post "${parentId}" not found`);
  }

  d.prepare(`
    INSERT INTO posts (id, author, title, body, tags, created_at, parent_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, author, title, body, JSON.stringify(tags), created_at, parentId || null);

  return { id, author, title, body, tags, created_at, parent_id: parentId || null };
}

export interface ListPostsOpts {
  limit?: number;
  before?: string;
  author?: string;
}

export interface BoardListResult {
  posts: BoardPost[];
  total: number;
}

export function listPosts(opts: ListPostsOpts = {}): BoardListResult {
  const d = getDb();
  const limit = Math.min(opts.limit || 50, 200);

  // Count total top-level posts (respecting author filter)
  let countSql = 'SELECT COUNT(*) AS c FROM posts WHERE parent_id IS NULL';
  const countParams: any[] = [];
  if (opts.author) {
    countSql += ' AND author = ?';
    countParams.push(opts.author);
  }
  const total = (d.prepare(countSql).get(...countParams) as any).c;

  let sql = `
    SELECT p.*, (SELECT COUNT(*) FROM posts r WHERE r.parent_id = p.id) AS reply_count
    FROM posts p
    WHERE p.parent_id IS NULL
  `;
  const params: any[] = [];

  if (opts.before) {
    sql += ' AND p.created_at < ?';
    params.push(opts.before);
  }
  if (opts.author) {
    sql += ' AND p.author = ?';
    params.push(opts.author);
  }

  sql += ' ORDER BY p.created_at DESC LIMIT ?';
  params.push(limit);

  const posts = d.prepare(sql).all(...params).map(rowToPost);
  return { posts, total };
}

export interface BoardThreadResult {
  post: BoardPost;
  replies: BoardPost[];
  reply_count: number;
}

export function getPost(id: string): BoardThreadResult | null {
  const d = getDb();
  const row = d.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM posts r WHERE r.parent_id = p.id) AS reply_count
    FROM posts p WHERE p.id = ?
  `).get(id) as any;
  if (!row) return null;

  const replies = d.prepare(`
    SELECT * FROM posts WHERE parent_id = ? ORDER BY created_at ASC
  `).all(id).map(rowToPost);

  const post = rowToPost(row);
  return { post, replies, reply_count: post.reply_count ?? replies.length };
}

export interface BoardRepliesResult {
  replies: BoardPost[];
  reply_count: number;
}

export function getReplies(postId: string): BoardRepliesResult {
  const d = getDb();
  const replies = d.prepare(`
    SELECT * FROM posts WHERE parent_id = ? ORDER BY created_at ASC
  `).all(postId).map(rowToPost);
  return { replies, reply_count: replies.length };
}

function rowToPost(row: any): BoardPost {
  return {
    id: row.id,
    author: row.author,
    title: row.title,
    body: row.body,
    tags: JSON.parse(row.tags || '[]'),
    created_at: row.created_at,
    parent_id: row.parent_id,
    reply_count: row.reply_count ?? undefined,
  };
}

export function getThreadParticipants(postId: string): { authors: string[]; title: string } {
  const d = getDb();
  const post = d.prepare('SELECT author, title FROM posts WHERE id = ?').get(postId) as any;
  if (!post) return { authors: [], title: '' };

  const replyAuthors = d.prepare(
    'SELECT DISTINCT author FROM posts WHERE parent_id = ?'
  ).all(postId).map((r: any) => r.author);

  const all = new Set<string>([post.author, ...replyAuthors]);
  return { authors: [...all], title: post.title };
}

// --- Filesystem migration ---

function parseFrontmatter(content: string): { meta: Record<string, any>; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta: Record<string, any> = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (m) {
      let val: any = m[2].trim();
      if (val.startsWith('[') && val.endsWith(']')) {
        val = val.slice(1, -1).split(',').map((s: string) => s.trim().replace(/^['"]|['"]$/g, ''));
      }
      meta[m[1]] = val;
    }
  }
  return { meta, body: match[2] };
}

function extractTitle(body: string): string {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

function inferAuthorFromFolder(folder: string): string {
  // Patterns: "proof-ops-1772...-slug", "2026-03-14-ops-slug", "fox-1772...-slug"
  // Try to extract author before the first timestamp-like segment
  const m = folder.match(/^(\d{4}-\d{2}-\d{2})-(\w+)-/);
  if (m) return m[2]; // "2026-03-14-ops-..." → "ops"

  const m2 = folder.match(/^([a-z][a-z0-9-]*?)-(\d{10,}|\d{4}-)/);
  if (m2) return m2[1]; // "proof-ops-1772..." → "proof-ops"

  return 'unknown';
}

export async function migrateFromFilesystem(postsDir: string): Promise<number> {
  const d = getDb();
  if (!fs.existsSync(postsDir)) return 0;

  const existing = (d.prepare('SELECT COUNT(*) as c FROM posts').get() as any).c;
  if (existing > 0) return 0; // already migrated

  const entries = await fsp.readdir(postsDir, { withFileTypes: true });
  const insert = d.prepare(`
    INSERT OR IGNORE INTO posts (id, author, title, body, tags, created_at, parent_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  const insertMany = d.transaction(() => {
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.DS_Store') continue;

      const postPath = path.join(postsDir, entry.name, 'post.md');
      if (!fs.existsSync(postPath)) continue;

      try {
        const raw = fs.readFileSync(postPath, 'utf-8');
        const { meta, body } = parseFrontmatter(raw);
        const stat = fs.statSync(postPath);

        const author = meta.author || inferAuthorFromFolder(entry.name);
        const title = extractTitle(body);
        const tags = Array.isArray(meta.tags) ? meta.tags : [];
        const created = meta.created || stat.mtime.toISOString();
        const postId = crypto.randomUUID();

        insert.run(postId, author, title, body.trim(), JSON.stringify(tags), created, null);
        count++;

        // Import replies
        const files = fs.readdirSync(path.join(postsDir, entry.name));
        for (const file of files) {
          if (!file.startsWith('reply-') || !file.endsWith('.md')) continue;
          const replyPath = path.join(postsDir, entry.name, file);
          try {
            const replyRaw = fs.readFileSync(replyPath, 'utf-8');
            const { meta: replyMeta, body: replyBody } = parseFrontmatter(replyRaw);

            // reply-<timestamp>-<author>.md
            const rm = file.match(/^reply-(\d+)-(.+)\.md$/);
            const replyAuthor = replyMeta.author || rm?.[2] || 'unknown';
            const replyCreated = replyMeta.created
              || (rm?.[1] ? new Date(parseInt(rm[1]) * 1000).toISOString() : stat.mtime.toISOString());

            insert.run(
              crypto.randomUUID(), replyAuthor, '', replyBody.trim(),
              '[]', replyCreated, postId,
            );
            count++;
          } catch { /* skip bad replies */ }
        }
      } catch { /* skip bad posts */ }
    }
  });

  insertMany();
  return count;
}
