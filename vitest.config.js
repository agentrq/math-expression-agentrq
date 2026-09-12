import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The drawer is DOM code — it makes elements, sets `innerHTML` and reads
    // `ownerDocument` — so it needs a document to be tested against rather than
    // a hand-written stub that agrees with whatever the test expects.
    environment: 'happy-dom',
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['index.js', 'src/drawer.js'],
      reporter: ['text'],
      // The same bar AgentRQ itself holds. An extension runs with the
      // privileges of the process it is in; "mostly tested" is not a standard
      // that belongs anywhere near that.
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
  resolve: {
    alias: {
      // The build hands the drawer KaTeX's stylesheet with the fonts inlined,
      // through a virtual module esbuild resolves. Under test there is no
      // esbuild, and 400 KB of base64 would prove nothing anyway: what the
      // tests care about is that the stylesheet is added once and only once.
      // `scripts/build.mjs` has its own test for the real thing.
      'katex-css': new URL('./test/stub/katex-css.js', import.meta.url).pathname,
    },
  },
})
