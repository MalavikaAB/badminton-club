import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight } from './_lib/http';
import { routeClubNight } from './_lib/router';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (handlePreflight(req, res)) return;
  await routeClubNight(req, res);
}
