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
 * Makes a copied equation paste as its TeX.
 *
 * Imported for its side effect, which is the whole of what it is: it registers
 * one `copy` listener on this document, and when the selection covers an
 * equation it rewrites the clipboard's plain-text to the source out of the
 * MathML `<annotation>`.
 *
 * Without it, selecting an equation and copying gives you KaTeX's *visual*
 * layer — the positioned glyphs, in reading order if you are lucky — which is
 * not TeX, not the equation, and not anything you can paste back into a message
 * and have render. The maths is in the document twice on purpose, once to look
 * at and once to mean something, and this decides which one the clipboard gets.
 *
 * The block's **Text** toggle still shows the exact source for reading. This is
 * for the much more common gesture of selecting the equation itself.
 */
import 'katex/contrib/copy-tex'

/** The delimiters `copy-tex` wraps its output in, display first. */
const COPIED_WRAPPER = /^\$\$([\s\S]*)\$\$$|^\$([\s\S]*)\$$/

/**
 * An unescaped dollar, for testing rather than replacing.
 *
 * Deliberately *not* the `/g` pattern used to escape them: `test` on a global
 * regex advances `lastIndex` and the next call starts from wherever the last
 * one stopped, so alternate calls with the same string disagree.
 */
const HAS_BARE_DOLLAR = /(?<!\\)\$/

/**
 * Takes `copy-tex`'s delimiters back off, because they render nowhere here.
 *
 * `copy-tex` wraps what it copies in `$…$` so the text pastes into a markdown
 * document as inline maths. That is right for GitHub and wrong for AgentRQ,
 * which has **no inline maths at all** — the markdown splitter only cuts on
 * fences, so `$x$` in a message is three literal characters and an `x`.
 *
 * So the delimiters are noise in every place the text can land here, and worse
 * than noise in the one that matters: paste a copied equation into a ```math
 * fence and the dollars are drawn, because this extension now draws them. Copy
 * and paste would not round-trip.
 *
 * Registered after `copy-tex`, so it runs second on the same event and edits
 * what that handler just wrote. Anything it does not recognise is left alone.
 */
export function unwrapCopiedTex(text) {
  const match = COPIED_WRAPPER.exec(text)
  if (!match) return text

  // Whichever group matched: `$$…$$` is tried first, so a display equation is
  // not unwrapped as an inline one with stray dollars left over.
  const inner = (match[1] ?? match[2]).trim()

  // A delimiter still loose inside means this was never a wrapper. `$a$ + $b$`
  // begins and ends with `$` without being wrapped in it, and unwrapping gives
  // `a$ + $b`, which is not an equation at all. This is the exact mistake the
  // extension's original delimiter-stripping made, and the one guard it got
  // right — an escaped `\$` is a dollar sign the author wrote, not a delimiter.
  if (HAS_BARE_DOLLAR.test(inner)) return text

  return inner
}

/**
 * Edits what `copy-tex` just put on the clipboard.
 *
 * Named and exported rather than written inline at the `addEventListener`,
 * because a handler that cannot be called in a test is a handler whose early
 * returns are never checked — and those are the paths that run when a copy has
 * nothing to do with an equation.
 */
export function rewriteCopiedTex(event) {
  const clipboardData = event?.clipboardData
  if (!clipboardData) return

  const copied = clipboardData.getData('text/plain')
  if (!copied) return

  const unwrapped = unwrapCopiedTex(copied)
  if (unwrapped !== copied) clipboardData.setData('text/plain', unwrapped)
}

// Second, after `copy-tex`'s own listener: handlers on the same target run in
// the order they were added, so this sees the text that one wrote.
document.addEventListener('copy', rewriteCopiedTex)

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
