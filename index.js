/**
 * Mathematical expressions in AgentRQ.
 *
 * Claims the ```math fence — GitHub's — and answers with a `math` diagram node
 * carrying the TeX. `src/drawer.js` typesets it.
 *
 * ## Why the TeX leaves here as text
 *
 * It would be shorter to run KaTeX in this file and hand back the HTML. It
 * would also be the one thing AgentRQ's extension model exists to prevent: this
 * half runs beside a renderer on a privileged `app://` origin with a bridge to
 * files, the clipboard and the shell, and third-party markup there has the
 * machine through an API built for the app's own UI. No node type carries
 * markup, and that is deliberate.
 *
 * KaTeX therefore runs in the drawer instead — a sandboxed frame with an opaque
 * origin, `default-src 'none'` and no network — where markup made from this
 * source can reach nothing. The boundary is the guard.
 *
 * What stays here is policy, and with TeX there is more of it than there was
 * with mermaid:
 *
 *   - which workspaces equations are drawn in,
 *   - how much expression is worth parsing,
 *   - normalising the delimiters people write out of habit,
 *   - and refusing commands that outlive the equation or reach outside it.
 *
 * ## Delimiters are stripped, not required
 *
 * GitHub's ```math fence takes no delimiters — the fence *is* the delimiter.
 * But almost everybody writing one has just come from a `$$…$$` block, and
 * writes those too. Left alone they render as literal dollar signs in front of
 * the equation, which reads as a typo in the maths rather than in the markup.
 * So one matched wrapper comes off: `$$…$$`, `\[…\]`, `\(…\)` or `$…$`.
 *
 * Only when it is unambiguous. `$$a$$ + $$b$$` starts and ends with `$$` and is
 * not wrapped in it, and stripping there would silently change what the
 * equation says — so a middle containing the delimiter again is left alone.
 *
 * ## What is refused, and why each one
 *
 * A refused expression is **not** an error — the block stays as the text it
 * was, which is exactly what somebody needs in order to see what is wrong with
 * it.
 *
 * **Macro definitions** (`\def`, `\gdef`, `\newcommand`, `\let`, `\global`, …).
 * KaTeX keeps macros in a `macros` object, and where that object is shared
 * between renders — which is how anyone gets `\newcommand` to work across a
 * document — `\gdef` writes into it. One equation in one message could then
 * redefine `\alpha` for every equation drawn after it in that window. Macros
 * are also how a small expression becomes an enormous one; KaTeX caps expansion
 * at `maxExpand`, and this is the second guard.
 *
 * **`\href`, `\url`, `\includegraphics`, `\htmlClass` and friends.** KaTeX gates
 * these behind its `trust` option: a link, a remote image or an HTML attribute,
 * written from inside an equation. A remote image in a message is a tracking
 * pixel with extra steps. The drawer sets `trust: false`, and this refuses them
 * as well — two guards failing differently: one is a setting that a later
 * refactor could change, the other is a rule with a test on it.
 */

export const name = 'math'

export const inject = ['renderers']

/** How much expression is worth parsing, when the setting is blank. */
export const DEFAULT_MAX_CHARS = 4000

/** The fence GitHub writes, and the one this exists for. */
export const GITHUB_LANGUAGE = 'math'

/**
 * Fences claimed only when asked for.
 *
 * A ```latex block is as often a whole document — `\documentclass`, a preamble,
 * `\begin{document}` — as it is an equation, and KaTeX draws none of that. So
 * claiming these by default would turn readable source into a block that
 * refuses to render, which is worse than leaving it as the code it was.
 */
export const TEX_LANGUAGES = Object.freeze(['latex', 'tex'])

/**
 * Commands this will not hand to the renderer.
 *
 * Two groups: macros that outlive the equation they are written in, and the
 * commands KaTeX gates behind `trust` because they reach outside it. Matched
 * case-sensitively, because TeX is — `\Def` is not a command, and pretending it
 * might be would refuse ordinary text for nothing.
 */
const REFUSED = Object.freeze([
  // Macros. `\def`/`\gdef`/`\edef`/`\xdef`, and LaTeX's spellings of the same.
  /\\[gex]?def(?![A-Za-z])/,
  /\\(?:new|renew|provide)command(?![A-Za-z])/,
  /\\newenvironment(?![A-Za-z])/,
  /\\(?:future)?let(?![A-Za-z])/,
  /\\global(?![A-Za-z])/,
  // Trust-gated: a link, an image, or an HTML attribute from inside an equation.
  /\\href(?![A-Za-z])/,
  /\\url(?![A-Za-z])/,
  /\\includegraphics(?![A-Za-z])/,
  /\\html(?:Class|Id|Style|Data)(?![A-Za-z])/,
])

/**
 * Delimiter pairs that come off, longest first.
 *
 * `$$` before `$`, so a display block is unwrapped as one rather than as a
 * `$…$` containing stray dollars.
 */
const WRAPPERS = Object.freeze([
  ['$$', '$$'],
  ['\\[', '\\]'],
  ['\\(', '\\)'],
  ['$', '$'],
])

/** Which workspaces the user limited this to, or none meaning all of them. */
export function allowedWorkspaces(config) {
  return String(config?.workspaces ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

/**
 * Whether equations are drawn in this workspace.
 *
 * Blank means everywhere, which is what somebody who has not thought about it
 * wants. A list means those and nowhere else.
 */
export function appliesTo(config, workspaceId) {
  const allowed = allowedWorkspaces(config)
  if (allowed.length === 0) return true
  return Boolean(workspaceId) && allowed.includes(workspaceId)
}

/**
 * The longest expression worth parsing, in characters.
 *
 * Characters rather than lines, because that is the shape of the thing: a
 * mermaid diagram is a program with a line per statement, and an equation is
 * frequently one very long line.
 */
export function maxChars(config) {
  const limit = Number(config?.maxChars)
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_MAX_CHARS
}

/** Which fences this claims, given what the user turned on. */
export function languages(config) {
  return config?.tex ? [GITHUB_LANGUAGE, ...TEX_LANGUAGES] : [GITHUB_LANGUAGE]
}

/**
 * Takes one matched pair of delimiters off, if there is exactly one.
 *
 * Exported because it is the part most likely to be wrong about somebody's
 * expression, and a rule that can be wrong should be a rule that can be read.
 */
export function unwrap(source) {
  const text = String(source ?? '').trim()

  for (const [open, close] of WRAPPERS) {
    // The open and the close have to be *different* characters, or `$$` reads
    // as a wrapper around itself. `>=` rather than `>`, because a wrapper with
    // nothing between it is an empty expression, which is a thing to have.
    if (text.length < open.length + close.length) continue
    if (!text.startsWith(open) || !text.endsWith(close)) continue

    const inner = text.slice(open.length, text.length - close.length)
    // The delimiter again inside means this was never a wrapper — `$$a$$ + $$b$$`
    // is two expressions and an operator, not one expression in dollar signs.
    if (inner.includes(open) || inner.includes(close)) continue

    return inner.trim()
  }

  return text
}

/** Whether the expression asks for something this will not pass on. */
export function isRefused(text) {
  return REFUSED.some((pattern) => pattern.test(text))
}

/**
 * What to do with one fence.
 *
 * Answers a `math` diagram node, or nothing at all. Nothing means the block
 * stays as the text it was — which is the right answer for every refusal here:
 * an expression that is too long, or one defining macros, is still something
 * the reader wants to see.
 */
export function renderBlock(source, config = {}) {
  const text = unwrap(source)
  if (!text) return null

  if (text.length > maxChars(config)) return null
  if (isRefused(text)) return null

  return { type: 'diagram', format: 'math', source: text }
}

export function apply(ctx, config) {
  for (const language of languages(config)) {
    ctx.renderers.add({
      id: language,
      language,
      label: 'Math',
      // Asked per block, with the workspace the message is in — so "enabled for
      // this workspace" is this extension's answer rather than a setting
      // AgentRQ keeps on its behalf.
      when: (context) => appliesTo(config, context?.workspaceId),
      run: (context) => {
        const view = renderBlock(context?.source, config)
        // Nothing drawn is a legitimate answer, and AgentRQ leaves the fence as
        // the text it was. An error would replace a readable code block with a
        // complaint about it.
        return view ? { nodes: [view] } : null
      },
    })
  }
}
