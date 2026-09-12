/**
 * Mathematical expressions in AgentRQ.
 *
 * Claims the ```math fence — GitHub's — and answers with a `math` diagram node
 * carrying the TeX. `src/drawer.js` typesets it.
 *
 * ## The spec is GitHub, and this does not add to it
 *
 * GitHub documents four ways to write maths, and one of them is a fenced
 * ```math block. What goes in that block is TeX, and GitHub renders it with
 * MathJax. That is the whole specification, and the thing this file is careful
 * *not* to do is invent more of it.
 *
 * So there is no length cap, no list of refused commands, and no delimiter
 * rewriting. An expression GitHub would render is an expression this draws.
 * Each of those would have been a rule somebody has to discover by having a
 * perfectly good equation silently not render.
 *
 * In particular, **macros are not refused**. GitHub's own documentation says
 * MathJax "supports a wide range of LaTeX macros", and `\def` inside a single
 * expression is ordinary TeX that people really write. What makes that safe is
 * not a regex here — it is that the drawer hands KaTeX a *fresh* macro store on
 * every call, so nothing defined in one equation exists in the next, and caps
 * expansion with `maxExpand` so a macro cannot unfold into an enormous one.
 * The guard is in the place that can actually enforce it.
 *
 * ## Delimiters are left exactly as written
 *
 * GitHub's line is that with the fence "you don't need to use `$$`
 * delimiters" — not that it removes them if you do. Stripping them would be
 * this extension quietly editing somebody's equation, and the cases where it
 * guesses wrong (`$$a$$ + $$b$$` is two expressions and an operator) change
 * what the maths says.
 *
 * ## What is left here
 *
 * Scope, and nothing else: which workspaces this draws in. That is not a rule
 * about maths, it is a preference about where an extension applies, and it is
 * the extension's to answer rather than a setting AgentRQ keeps for it.
 */

export const name = 'math'

export const inject = ['renderers']

/** The fence GitHub writes, and the only one this claims. */
export const LANGUAGE = 'math'

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
 * What to do with one fence.
 *
 * Answers a `math` diagram node, or nothing for a block with no expression in
 * it. Nothing means the block stays as the text it was, which is the right
 * answer for an empty fence: there is no equation to draw and no error to
 * report either.
 *
 * An expression that will not *parse* is not refused here. It goes to the
 * drawer, which throws, and AgentRQ shows the reason with the source underneath
 * — which is what whoever wrote the equation needs in order to fix it. Refusing
 * it here would leave a bare code block saying nothing about what was wrong.
 */
export function renderBlock(source) {
  const text = String(source ?? '').trim()
  if (!text) return null

  return { type: 'diagram', format: 'math', source: text }
}

export function apply(ctx, config) {
  ctx.renderers.add({
    id: LANGUAGE,
    language: LANGUAGE,
    label: 'Math',
    // Asked per block, with the workspace the message is in — so "enabled for
    // this workspace" is this extension's answer rather than a setting AgentRQ
    // keeps on its behalf.
    when: (context) => appliesTo(config, context?.workspaceId),
    run: (context) => {
      const view = renderBlock(context?.source)
      return view ? { nodes: [view] } : null
    },
  })
}
