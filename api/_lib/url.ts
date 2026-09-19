export function joinUrl(base: string, ...parts: string[]): string {
  const segs = [base, ...parts].flatMap((s) => s.split('/').filter(Boolean));
  return '/' + segs.join('/');
}