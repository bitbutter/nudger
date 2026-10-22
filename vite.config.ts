import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The CSP is injected only into the production HTML. Vite's dev server needs
 * inline scripts for React Fast Refresh and a websocket for HMR, so a strict
 * meta CSP would break `npm run dev`. The built site always gets the CSP.
 *
 * connect-src must allow arbitrary HTTPS origins because users may point the
 * app at any OpenAI-compatible endpoint (see README: security tradeoff).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https:",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');

function cspPlugin() {
  return {
    name: 'nudger-csp-meta',
    apply: 'build' as const,
    transformIndexHtml(html: string) {
      return html.replace(
        '</head>',
        `    <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n  </head>`,
      );
    },
  };
}

export default defineConfig({
  // Relative asset paths keep the build working from any repository subpath.
  base: './',
  plugins: [react(), cspPlugin()],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
