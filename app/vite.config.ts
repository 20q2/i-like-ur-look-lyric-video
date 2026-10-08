import { defineConfig, normalizePath, type Plugin } from 'vite';
import { cpSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const assetDirs = ['audio', 'data']; // served in dev
// Only data/ goes into builds: audio/ holds the song, which must never end up in a deployable bundle.
const bundledDirs = ['data'];

// Git can check out directory symlinks as plain files on Windows. Serve the
// original assets through Vite and copy them into builds without using symlinks.
function repoAssets(): Plugin {
  return {
    name: 'repo-assets',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (assetDirs.some((dir) => req.url?.startsWith(`/${dir}/`))) {
          req.url = `/@fs/${encodeURI(normalizePath(repoRoot))}${req.url}`;
        }
        next();
      });
    },
    writeBundle(options) {
      if (!options.dir) return;
      for (const dir of bundledDirs) {
        cpSync(path.join(repoRoot, dir), path.join(options.dir, dir), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  // each tree's own dependency cache (git worktrees share node_modules through a junction, and every server
  // re-optimising into node_modules/.vite rewrote the others' — the live preview's included)
  cacheDir: '.vite-cache',
  plugins: [repoAssets()],
  // LV_NO_HMR=1: no live reload (export renders must not reload mid-run when a file changes)
  // 5391: this project's own default (5173/5174 belong to another project here); if busy, vite takes the next free port
  server: { port: 5391, strictPort: false, hmr: process.env.LV_NO_HMR ? false : undefined, fs: { allow: [repoRoot] } },
  resolve: { alias: { '@root': repoRoot } },
  build: { target: 'esnext', assetsInlineLimit: 0 },
});
