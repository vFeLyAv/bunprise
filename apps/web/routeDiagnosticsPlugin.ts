import type { Plugin } from 'vite';

/** Classifications from the local browser, with no user data or error text. */
export function routeDiagnosticsPlugin(): Plugin {
  return {
    name: 'bunprise:local-route-diagnostics', apply: 'serve',
    configureServer(server) {
      server.config.logger.info(`BUNPRISE_CONFIG_DIAG ${JSON.stringify({
        hasSupabaseUrl: Boolean(server.config.env.VITE_SUPABASE_URL),
        hasPublishableKey: Boolean(server.config.env.VITE_SUPABASE_PUBLISHABLE_KEY),
        demo: server.config.env.VITE_DEMO === '1', google: server.config.env.VITE_GOOGLE_ENABLED === '1',
        isolated: process.env.BUNPRISE_ISOLATED_CHECK === '1',
      })}`);
      server.ws.on('bunprise:route-error', (data: unknown) => {
        if (!data || typeof data !== 'object') return;
        const value = data as Record<string, unknown>;
        const word = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(v) ? v : undefined;
        const frames = Array.isArray(value.frames) ? value.frames.filter((frame): frame is string =>
          typeof frame === 'string' && /^(src|node_modules)\/[A-Za-z0-9_./@-]+:\d+:\d+$/.test(frame),
        ).slice(0, 5) : [];
        server.config.logger.warn(`BUNPRISE_ROUTE_DIAG ${JSON.stringify({ name: word(value.name), code: word(value.code), category: word(value.category), status: typeof value.status === 'number' ? value.status : undefined, auth: value.auth === true, frames })}`);
      });
    },
  };
}
