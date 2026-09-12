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
 * ## This file holds the guards, because it is the only place that can
 *
 * `index.js` refuses nothing — GitHub renders macros and so does this, and an
 * expression GitHub would draw is one this draws. That is only safe because the
 * two things which make macros dangerous are handled *here*, by construction
 * rather than by pattern-matching the source:
 *
 *   - **a fresh `macros` object on every call**, so a `\gdef` in one equation
 *     does not exist in the next one. Macros leak through a *shared* store, and
 *     the way to not share it is to not share it.
 *   - **`maxExpand`**, KaTeX's own cap on how far a macro may unfold, so a
 *     three-line expression cannot expand into an enormous one.
 *
 * And `trust: false`, which is what keeps `\href`, `\includegraphics` and the
 * `\html…` commands from producing a link, a remote image or an HTML attribute.
 * They still *render* — as inert text, the way GitHub renders them — rather
 * than causing the whole block to refuse to draw.
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
    // Not a link, not an image, not an HTML attribute — from inside an
    // equation. The command still renders, inertly, as GitHub renders it.
    trust: false,
    strict: false,
    // A fresh object per call, and the whole reason macros can be allowed at
    // all: KaTeX writes `\gdef` into whatever store it is handed, so a shared
    // one would let an equation redefine a symbol for every equation drawn
    // after it. A new one per call means `\def` works inside an expression and
    // is gone by the next.
    macros: {},
    // KaTeX's own cap on macro expansion, so a short expression cannot unfold
    // into an enormous one.
    maxExpand: 1000,
  }
}

/**
 * A dollar sign that is not already escaped.
 *
 * Lookbehind rather than a captured preceding character, because `$$` is the
 * whole point and consecutive matches overlap: `/(^|[^\\])\$/g` consumes the
 * character before each `$`, so in `$$` the second one is never matched and the
 * expression still fails.
 */
const BARE_DOLLAR = /(?<!\\)\$/g

/**
 * Makes a bare `$` into a dollar sign, because that is what GitHub draws.
 *
 * GitHub renders with MathJax, which treats a `$` inside a math block as an
 * ordinary character — `$$a^2+b^2=c^2$$` draws the equation with visible dollar
 * signs at both ends. KaTeX refuses the same input outright: *"Can't use
 * function '$' in math mode"*. Verified against both engines rather than
 * reasoned about, because the guess went the other way the first time.
 *
 * That matters more than it looks. Writing `$$…$$` inside a ```math fence is a
 * habit people bring from every other markdown editor, and without this the
 * block fails to draw at all.
 *
 * **This is not the delimiter-stripping this extension used to do.** Nothing is
 * removed and the expression is not rewritten to mean something else — the
 * dollars stay, and are drawn, exactly as GitHub draws them. An escape is how
 * you write a literal `$` in TeX; this writes it for the author.
 *
 * Known edge: `\\$` — a TeX line break immediately followed by a dollar — is
 * left alone, because the lookbehind sees the second backslash. It is the one
 * input where KaTeX still refuses and MathJax does not, and rare enough to be
 * worth less than the complexity of counting backslashes.
 */
export function escapeDollars(text) {
  return text.replace(BARE_DOLLAR, '\\$')
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
  const html = katex.renderToString(escapeDollars(text), katexOptions())

  const box = doc.createElement('div')
  // The one place `innerHTML` is right: this document is the sandbox, and the
  // markup cannot reach the app, the bridge or the network. That is the entire
  // reason the frame exists.
  box.innerHTML = html
  root.replaceChildren(box)

  await fontsReady(doc)
}
