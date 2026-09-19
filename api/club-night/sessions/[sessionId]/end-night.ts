import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, sendJson } from '../../../../_lib/http';
import { ensureSchema } from '../../../../_lib/schema';
import { endNight } from '../../../../_lib/repo';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') { sendJson(res, 405, { message: 'Method not allowed' }); return; }
  try {
    await ensureSchema();
    await endNight(String((req.query as any)?.sessionId ?? ''));
    sendJson(res, 200, { roundNumber: 0, courts: [], waiting: [] });
  } catch (e: any) {
    sendJson(res, 500, { message: e?.message ?? 'End night failed' });
  }
}
