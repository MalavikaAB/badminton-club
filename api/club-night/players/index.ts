import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { handlePreflight, readJson, sendError, sendJson } from '../../_lib/http';
import { db } from '../../_lib/db';
import { ensureSchema } from '../../_lib/schema';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (handlePreflight(req, res)) return;
  try {
    await ensureSchema();
    const sql = db();
    if (req.method === 'GET') {
      const rows = await sql`select id, name, gender, division, games_played
        from players where active = true order by name`;
      sendJson(res, 200, (rows as any[]).map((r) => ({
        id: String(r.id), name: r.name, gender: r.gender, division: r.division, gamesPlayed: Number(r.games_played),
      })));
      return;
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      const name = String(body?.name ?? '').trim();
      const gender = body?.gender;
      const division = String(body?.division ?? '').trim();
      if (!name || (gender !== 'MALE' && gender !== 'FEMALE') || !division) {
        sendError(res, 400, 'Name, gender and division are required');
        return;
      }
      const id = randomUUID();
      await sql`insert into players (id, name, gender, division) values (${id}, ${name}, ${gender}, ${division})`;
      sendJson(res, 200, { id, name, gender, division, gamesPlayed: 0 });
      return;
    }
    sendJson(res, 405, { message: 'Method not allowed' });
  } catch (e: any) {
    sendJson(res, 500, { message: e?.message ?? 'Players request failed' });
  }
}

