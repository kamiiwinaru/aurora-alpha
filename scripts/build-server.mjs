import { build } from 'esbuild'

await build({
  entryPoints: ['server/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'dist-server/index.js',
  format: 'cjs',
  // These are Electron's built-ins — don't bundle them
  external: ['electron'],
  // Mark sharp as external (native module, only used in dev for icon gen)
  // All other deps are bundled into the single file
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  // In production, main.ts loads the .env before require()-ing the server.
  // Strip the dotenv.config() call so it doesn't overwrite or fail silently.
  banner: {
    js: `// Aurora production server bundle\n`,
  },
  minify: false,  // keep readable for debugging
})

console.log('Server bundled → dist-server/index.js')
