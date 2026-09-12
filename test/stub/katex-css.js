/**
 * Stands in for the bundled stylesheet under test.
 *
 * The real one is KaTeX's CSS with twenty fonts inlined as `data:` URIs, built
 * by `scripts/build.mjs` and handed to the drawer as a virtual module. The
 * drawer only ever puts it in a `<style>` element, so a marker string exercises
 * that path exactly as the real one would, and a failure points at the drawer
 * rather than at half a megabyte of base64.
 */
export default '.katex{font-family:KaTeX_Main}'
