/**
 * Typesetting equations, inside the frame AgentRQ gives this extension.
 *
 * This file is the whole of what runs on the other side of the boundary. It is
 * bundled — KaTeX, its stylesheet and its twenty fonts — into one script,
 * because that is what a drawer is: a sandboxed document with an opaque origin,
 * no bridge, and `default-src 'none'`. Nothing here can fetch anything, so
 * everything it needs has to already be in the bundle. See `scripts/build.mjs`
 * for how the fonts get in.
 *
 * ## Why the extension can draw at all now
 *
 * It used to be that no extension could produce markup: the renderer sits on a
 * privileged `app://` origin with a bridge to files, the clipboard and the
 * shell, and third-party HTML there has the machine. So the rule was
 * *extensions describe, AgentRQ renders*, and this extension shipped as policy
 * only, waiting for a host that knew how to draw maths.
 *
 * The frame changes the shape of that rule rather than breaking it. Markup made
 * from this extension's source now stays inside a document that can reach
 * nothing — no network, no parent, no bridge. So `innerHTML` below is safe for
 * the same reason mermaid's is: the boundary is the guard, not a sanitiser.
 *
 * ## What is still refused before anything gets here
 *
 * `index.js` turns away macro definitions and KaTeX's `trust`-gated commands
 * (`\href`, `\includegraphics`, …) before an expression reaches this file, and
 * this file sets `trust: false` and a fresh `macros` object per call regardless.
 * Two guards failing differently: one is a rule with a test on it, the other a
 * setting a later refactor would have to go out of its way to change.
 */
import katex from 'katex'
import katexCss from 'katex-css'

/**
 * KaTeX's stylesheet, added once per document.
 *
 * `adoptedStyleSheets` would be tidier, but the CSS carries 400 KB of inlined
 * fonts and a `<style>` element is what every browser parses the same way. The
 * frame is reused across draws, so this must not re-add it each time.
 */
const STYLE_ID = 'agentrq-katex-css'

/**
 * What the frame does not give us and an equation needs.
 *
 * The frame's own reset sizes `svg` and `img` but an equation is neither — it
 * is a pile of positioned spans. A long one is genuinely wider than the panel,
 * and the honest answer is to let that line scroll: shrinking it would make the
 * subscripts unreadable, and clipping it would hide the right-hand side of the
 * equation with nothing to say it had been hidden.
 *
 * The display margin goes because the frame is sized to its content — KaTeX's
 * default `1em` top and bottom would be measured as part of the equation and
 * drawn as a gap inside the block, on top of the block's own padding.
 */
const FRAME_CSS = `
.katex-display { margin: 0; overflow-x: auto; overflow-y: hidden; padding: 2px 0; }
.katex { color: inherit; }
`

/** Adds the stylesheet to this document, the first time only. */
export function ensureStyles(doc) {
  if (!doc || doc.getElementById(STYLE_ID)) return false

  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = `${katexCss}\n${FRAME_CSS}`
  doc.head.appendChild(style)
  return true
}

/**
 * How KaTeX is called, every time.
 *
 * `displayMode` because a fenced block is display maths — GitHub centres these
 * too, and an equation on its own line reading as inline text is the wrong
 * shape for the thing.
 *
 * `throwOnError` so a broken expression becomes the frame's error, with the
 * source underneath it, rather than KaTeX's red text saying the same thing in a
 * place that cannot be copied out.
 *
 * `strict: false` because the strict setting's real job is warning about TeX
 * that renders differently in LaTeX proper — Unicode in the middle of an
 * expression, mostly — and an author who wrote `α` meant `α`. The default
 * writes those warnings to a console nobody can open.
 */
export function katexOptions() {
  return {
    displayMode: true,
    throwOnError: true,
    output: 'htmlAndMathml',
    // Not a link, not an image, not an HTML attribute — from inside an equation.
    trust: false,
    strict: false,
    // A fresh object per call: KaTeX writes `\gdef` into whatever it is handed,
    // and a shared one would let an equation redefine a symbol for every
    // equation drawn after it.
    macros: {},
    maxExpand: 1000,
  }
}

/**
 * Waits for the inlined fonts, when the document can say.
 *
 * The frame measures the height the moment `draw` resolves. KaTeX's metrics
 * come from the CSS, but the *rendered* height still moves when a font swaps
 * in, and a frame measured a frame too early keeps the wrong height until
 * something else makes it redraw. `document.fonts` is absent in a test DOM and
 * a font that never loads must not hang the block, so neither case waits.
 */
export async function fontsReady(doc) {
  try {
    await doc?.fonts?.ready
  } catch {
    // A font that failed is still an equation worth drawing, in a fallback face.
  }
}

/**
 * Draws one expression into the element the frame provides.
 *
 * Throws on an expression that will not parse, and lets the frame report it:
 * the block outside shows the reason with the TeX underneath, which is what
 * whoever wrote the equation needs in order to fix it.
 */
export default async function draw(root, source) {
  const text = String(source ?? '').trim()
  if (!text) throw new Error('This equation is empty.')

  const doc = root.ownerDocument
  ensureStyles(doc)

  // `renderToString` rather than `katex.render`, so a failed parse throws
  // before the old equation is cleared: a block that fails to redraw keeps
  // showing the last thing that worked until the frame replaces it.
  const html = katex.renderToString(text, katexOptions())

  const box = doc.createElement('div')
  // The one place `innerHTML` is right: this document is the sandbox, and the
  // markup cannot reach the app, the bridge or the network. That is the entire
  // reason the frame exists.
  box.innerHTML = html
  root.replaceChildren(box)

  await fontsReady(doc)
}
