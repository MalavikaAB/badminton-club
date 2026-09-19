import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, sendJson } from './_lib/http.js';
import { routeClubNight } from './_lib/router.js';

export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
};

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    if (handlePreflight(req, res)) return;
    await routeClubNight(req, res);
  } catch (error: any) {
    sendJson(res, 500, { message: error?.message ?? 'Function failed' });
  }
}
