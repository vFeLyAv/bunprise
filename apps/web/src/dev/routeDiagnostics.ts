/** Development-only classifications; never send error messages, URLs, sessions or response bodies. */
export function reportRouteError(error: unknown): void {
  if (!import.meta.hot || !(error instanceof Error)) return;
  const value = error as Error & { code?: unknown; status?: unknown; __isAuthError?: unknown };
  const name = /^[A-Za-z]{1,40}$/.test(value.name) ? value.name : 'Error';
  const code = typeof value.code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(value.code) ? value.code : undefined;
  const categories: Array<readonly [string, RegExp]> = [
    ['chunk_import', /failed to fetch dynamically imported module|loading chunk|importing a module script failed/i],
    ['missing_configuration', /supabaseUrl is required|supabaseKey is required|missing (?:Supabase|VITE_SUPABASE_)/i],
    ['invalid_json', /unexpected token|JSON.parse|not valid JSON/i],
    ['refresh_token', /refresh token/i],
    ['network', /failed to fetch|networkerror|load failed/i],
  ];
  const frames = (error.stack ?? '').split('\n').slice(1).flatMap(line => {
    const match = /\/(src\/|node_modules\/)([A-Za-z0-9_./@-]+)(?:\?[^: ]*)?:(\d+):(\d+)/.exec(line);
    return match ? [`${match[1]}${match[2]}:${match[3]}:${match[4]}`] : [];
  }).slice(0, 5);
  import.meta.hot.send('bunprise:route-error', {
    name, code, status: typeof value.status === 'number' ? value.status : undefined,
    auth: value.__isAuthError === true, category: categories.find(([, pattern]) => pattern.test(error.message))?.[0] ?? 'other', frames,
  });
}
