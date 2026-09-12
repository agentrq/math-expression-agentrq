/**
 * Bundling the drawer, fonts and all.
 *
 * A drawer runs in a sandboxed frame whose policy is `default-src 'none'` with
 * `font-src data:` — no network, at all. KaTeX's stylesheet asks for twenty font
 * files by relative URL, and every one of those requests would be refused. An
 * equation drawn without them still lays out, because the metrics are in the
 * CSS, but it is set in whatever the frame's fallback font is: the glyphs are
 * the wrong shapes at the right sizes, which looks like a rendering bug rather
 * than a missing font.
 *
 * So the fonts travel *in* the bundle, as `data:` URIs, which is the one source
 * the policy permits. That is what this script is for. Two passes:
 *
 *   1. Bundle KaTeX's CSS, turning each `url(fonts/….woff2)` into a data URI.
 *   2. Bundle the drawer, with that CSS handed to it as a string through a
 *      virtual module.
 *
 * ## Why the other font formats are stripped first
 *
 * Each `@font-face` names the same font three times — woff2, woff, then ttf —
 * so a 1996 browser can still find one it understands. Inlining all three would
 * put 1.1 MB of duplicate fonts in the bundle to be parsed and discarded, since
 * the frame is Chromium and Chromium takes the woff2 every time. Dropping the
 * other two before the CSS is bundled costs nothing and saves 800 KB.
 */
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const require = createRequire(import.meta.url)

/** KaTeX's stylesheet, and the directory its `url(fonts/…)` are relative to. */
const CSS_PATH = require.resolve('katex/dist/katex.min.css')

/**
 * The woff and ttf alternatives in a `src:` list.
 *
 * Matched as ", url(…) format("…")" so the leading comma goes with them and the
 * woff2 that stays is still a well-formed `src`.
 */
const OTHER_FORMATS = /,\s*url\([^)]*\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g

/** KaTeX's CSS with the fonts inlined, as a string. */
export async function inlineFontCss() {
  const source = await readFile(CSS_PATH, 'utf8')

  const result = await build({
    stdin: {
      contents: source.replace(OTHER_FORMATS, ''),
      // Relative to KaTeX's own dist, so `url(fonts/…)` resolves to the files
      // rather than to this script's directory.
      resolveDir: dirname(CSS_PATH),
      loader: 'css',
    },
    bundle: true,
    minify: true,
    write: false,
    loader: { '.woff2': 'dataurl' },
  })

  return result.outputFiles[0].text
}

/**
 * Hands the inlined CSS to the drawer as `import css from 'katex-css'`.
 *
 * A virtual module rather than a generated file on disk: the CSS is a build
 * artefact of a dependency, and a 400 KB base64 blob checked into the tree is
 * something that gets stale without anyone noticing.
 */
function katexCssPlugin(css) {
  return {
    name: 'katex-css',
    setup(builder) {
      builder.onResolve({ filter: /^katex-css$/ }, () => ({ path: 'katex-css', namespace: 'katex-css' }))
      builder.onLoad({ filter: /.*/, namespace: 'katex-css' }, () => ({ contents: css, loader: 'text' }))
    },
  }
}

const css = await inlineFontCss()

await build({
  entryPoints: ['src/drawer.js'],
  outfile: 'dist/drawer.js',
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  plugins: [katexCssPlugin(css)],
})
