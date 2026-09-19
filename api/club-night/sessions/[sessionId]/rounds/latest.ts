import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, sendJson } from '../../../../_lib/http';
import { ensureSchema } from '../../../../_lib/schema';
import { openNightId, resetStaleNight } from '../../../../_lib/repo';
import { loadCheckedInPlayers, serializeAllocation } from '../../../../_lib/repo2';
import { latestRound } from '../../../../_lib/latest';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'GET') { sendJson(res, 405, { message: 'Method not allowed' }); return; }
  try {
    await ensureSchema();
    const sessionId = String((req.query as any)?.sessionId ?? '');
    await resetStaleNight(sessionId);
    const alloc = await latestRound(sessionId);
    if (alloc.roundNumber === 0) {
      const nightId = await openNightId(sessionId);
      const waiting = await loadCheckedInPlayers(sessionId, nightId);
      sendJson(res, 200, serializeAllocation({ roundNumber: 0, courts: [], waiting }));
      return;
    }
    const nightId = await openNightId(sessionId);
    const checked = await loadCheckedInPlayers(sessionId, nightId);
    const assigned = new Set(alloc.courts.flatMap((c) => c.players.map((p) => p.id)));
    const waiting = checked.filter((p) => !assigned.has(p.id));
    sendJson(res, 200, serializeAllocation({ ...alloc, waiting }));
  } catch (e: any) {
    sendJson(res, 500, { message: e?.message ?? 'Could not load latest round' });
  }
}
