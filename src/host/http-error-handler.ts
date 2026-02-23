import type * as http from 'node:http';

/**
 * Represents a known error from an unknown source.
 * Safely extracts message from Error objects, strings, or other thrown values.
 */
interface SafeError {
  message: string;
  status: number;
}

/**
 * Converts an unknown error (from catch block) into a safe error object.
 * Handles Error objects, strings, objects with message property, and unknown types.
 */
function toSafeError(err: unknown, defaultStatus: number = 400): SafeError {
  // Error object
  if (err instanceof Error) {
    return { message: err.message, status: defaultStatus };
  }
  
  // String
  if (typeof err === 'string') {
    return { message: err, status: defaultStatus };
  }
  
  // Object with message property
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = typeof err.message === 'string' ? err.message : String(err.message);
    return { message: msg, status: defaultStatus };
  }
  
  // Unknown - don't leak internal details
  return { message: 'An error occurred', status: defaultStatus };
}

/**
 * Sends an error response with proper type safety.
 * Replaces the pattern: catch (err) { res.writeHead(400); res.end(err.message); }
 * 
 * @param res - The HTTP response object
 * @param err - The caught error (unknown type)
 * @param status - HTTP status code (default: 400)
 * 
 * @example
 * try {
 *   await riskyOperation();
 *   res.writeHead(200); res.end('ok');
 * } catch (err) {
 *   sendErrorResponse(res, err);
 * }
 */
export function sendErrorResponse(
  res: http.ServerResponse,
  err: unknown,
  status: number = 400
): void {
  const safeErr = toSafeError(err, status);
  res.writeHead(safeErr.status);
  res.end(safeErr.message);
}

/**
 * Sends a JSON error response with proper type safety.
 * 
 * @param res - The HTTP response object
 * @param err - The caught error (unknown type)
 * @param status - HTTP status code (default: 400)
 * 
 * @example
 * try {
 *   const data = await fetchData();
 *   res.writeHead(200, { 'Content-Type': 'application/json' });
 *   res.end(JSON.stringify(data));
 * } catch (err) {
 *   sendJsonErrorResponse(res, err, 500);
 * }
 */
export function sendJsonErrorResponse(
  res: http.ServerResponse,
  err: unknown,
  status: number = 400
): void {
  const safeErr = toSafeError(err, status);
  res.writeHead(safeErr.status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: safeErr.message }));
}
