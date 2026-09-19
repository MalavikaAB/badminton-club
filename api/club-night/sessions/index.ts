import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, sendJson } from '../../_lib/http';
import { ensureSchema } from '../../_lib/schema';
import { sessions } from '../../_lib/repo';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'GET') { sendJson(res, 405, { message: 'Method not allowed' }); return; }
  try {
    await ensureSchema();
    sendJson(res, 200, await sessions());
  } catch (e: any) {
    sendJson(res, 500, { message: e?.message ?? 'Could not load sessions' });
  }
}

