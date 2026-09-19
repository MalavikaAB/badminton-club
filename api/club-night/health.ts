import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, sendJson } from '../_lib/http';
import { ensureSchema } from '../_lib/schema';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'GET') { sendJson(res, 405, { message: 'Method not allowed' }); return; }
  try {
    await ensureSchema();
    sendJson(res, 200, { status: 'ready', service: 'club-night-backend' });
  } catch (e: any) {
    sendJson(res, 500, { message: e?.message ?? 'Health check failed' });
  }
}

