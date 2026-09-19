import type { VercelRequest, VercelResponse } from '@vercel/node';

export function applyCors(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/** Returns true when the request was an OPTIONS preflight that is now handled. */
export function handlePreflight(req: VercelRequest, res: VercelResponse): boolean {
  applyCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export function sendJson(res: VercelResponse, status: number, body: unknown): void {
  applyCors(res);
  res.status(status)on(body);
}

/**
 * Error shape mirrors Spring Boot (server.error.include-message=always):
 * the frontend reads `message` to explain refused swaps.
 */
export function sendError(res: VercelResponse, status: number, message: string): void {
  sendJson(res, status, { message });
}

export async function readJson(req: VercelRequest): Promise<any> {
  const body: any = (req as any).body;
  if (body === undefined || body === null) return {};
  if (typeof body === 'object') return body;
  if (typeof body === 'string' && body.length > 0) {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return {};
}

