import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

export interface SeeResult {
  ok: boolean;
  /** Anthropic-format image content block */
  image?: {
    type: 'image';
    source: {
      type: 'base64';
      media_type: string;
      data: string;
    };
  };
  /** Optional text description alongside the image */
  text?: string;
  error?: string;
}

/** Media types supported by Anthropic's vision API */
const SUPPORTED_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

// Max image size: 5MB before base64 encoding (Anthropic limit is ~5MB for base64)
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function guessMimeType(urlOrPath: string, contentType?: string): string | null {
  if (contentType) {
    // Strip charset/params: "image/png; charset=..." -> "image/png"
    const mime = contentType.split(';')[0].trim().toLowerCase();
    if (SUPPORTED_MEDIA_TYPES.has(mime)) return mime;
    if (mime.startsWith('image/')) return null; // unsupported image type
  }
  const ext = extname(urlOrPath).toLowerCase().split('?')[0];
  return EXT_TO_MIME[ext] || null;
}

/**
 * Fetch an image from a URL. Returns base64-encoded data.
 */
async function fetchImage(url: string): Promise<SeeResult> {
  try {
    const response = await fetch(url, {
      headers: {
        // Some servers require a user-agent
        'User-Agent': 'Mozilla/5.0 (compatible; openseed/1.0)',
        'Accept': 'image/*,*/*',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}: ${response.statusText} for ${url}` };
    }

    const contentType = response.headers.get('content-type') || '';
    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length > MAX_IMAGE_BYTES) {
      return {
        ok: false,
        error: `Image too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB (max ${MAX_IMAGE_BYTES / 1024 / 1024}MB)`,
      };
    }

    if (buffer.length === 0) {
      return { ok: false, error: 'Empty response body' };
    }

    const mediaType = guessMimeType(url, contentType);
    if (!mediaType) {
      const detectedType = contentType.split(';')[0].trim() || extname(url).toLowerCase();
      return {
        ok: false,
        error: `Unsupported image type: ${detectedType}. Supported types: JPEG, PNG, GIF, WebP.`,
      };
    }

    const data = buffer.toString('base64');

    return {
      ok: true,
      image: {
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data },
      },
      text: `Image from ${url} (${mediaType}, ${(buffer.length / 1024).toFixed(0)}KB)`,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to fetch image: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Read an image from a local file path. Returns base64-encoded data.
 */
async function readLocalImage(filePath: string): Promise<SeeResult> {
  try {
    const buffer = await readFile(filePath);

    if (buffer.length > MAX_IMAGE_BYTES) {
      return {
        ok: false,
        error: `Image too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB (max ${MAX_IMAGE_BYTES / 1024 / 1024}MB)`,
      };
    }

    if (buffer.length === 0) {
      return { ok: false, error: `File is empty: ${filePath}` };
    }

    const mediaType = guessMimeType(filePath);
    if (!mediaType) {
      const ext = extname(filePath).toLowerCase();
      return {
        ok: false,
        error: `Unsupported image type: ${ext || 'unknown'}. Supported types: JPEG, PNG, GIF, WebP.`,
      };
    }

    const data = buffer.toString('base64');

    return {
      ok: true,
      image: {
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data },
      },
      text: `Image from ${filePath} (${mediaType}, ${(buffer.length / 1024).toFixed(0)}KB)`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT')) {
      return { ok: false, error: `File not found: ${filePath}` };
    }
    return { ok: false, error: `Failed to read image: ${msg}` };
  }
}

/**
 * See an image from a URL or local file path.
 * Returns an Anthropic-format image content block ready to be included
 * in a tool result.
 */
export async function see(input: { url?: string; path?: string }): Promise<SeeResult> {
  if (!input.url && !input.path) {
    return { ok: false, error: 'Provide either "url" or "path" to see an image' };
  }

  if (input.url && input.path) {
    return { ok: false, error: 'Provide either "url" or "path", not both' };
  }

  if (input.url) {
    return fetchImage(input.url);
  }

  return readLocalImage(input.path!);
}
