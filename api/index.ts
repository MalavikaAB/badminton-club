import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    const { handlePreflight } = await import('./_lib/http');
    if (handlePreflight(req, res)) return;
    const { routeClubNight } = await import('./_lib/router');
    await routeClubNight(req, res);
  } catch (error: any) {
    if (res.headersSent) return;
    res.statusCode = 500;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ message: error?.message ?? 'Function failed to start' }));
  }
}
