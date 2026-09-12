import { describe, it, expect } from 'vitest'

import {
  DEFAULT_MAX_CHARS,
  GITHUB_LANGUAGE,
  TEX_LANGUAGES,
  allowedWorkspaces,
  appliesTo,
  apply,
  isRefused,
  languages,
  maxChars,
  renderBlock,
  unwrap,
} from '../index.js'

/**
 * This half of the extension draws nothing.
 *
 * It decides *whether* an expression is drawn and hands the TeX over; the
 * drawing happens in `src/drawer.js`, inside a sandboxed frame, and is tested
 * separately. So what is worth testing here is the policy: which workspaces,
 * how much expression, which delimiters come off, and what it will not pass on.
 */

const QUADRATIC = 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'

describe('allowedWorkspaces', () => {
  it('reads a list somebody typed, however they spaced it', () => {
    expect(allowedWorkspaces({ workspaces: 'ws1, ws2 ,ws3' })).toEqual(['ws1', 'ws2', 'ws3'])
  })

  it('is empty when nothing was said', () => {
    expect(allowedWorkspaces({})).toEqual([])
    expect(allowedWorkspaces({ workspaces: '  ' })).toEqual([])
    expect(allowedWorkspaces(undefined)).toEqual([])
  })

  it('drops the gaps left by a trailing comma', () => {
    expect(allowedWorkspaces({ workspaces: 'ws1,,ws2,' })).toEqual(['ws1', 'ws2'])
  })
})

describe('appliesTo', () => {
  it('draws everywhere when no workspaces were named', () => {
    expect(appliesTo({}, 'ws1')).toBe(true)
    expect(appliesTo({ workspaces: '' }, 'ws9')).toBe(true)
  })

  it('draws only where it was told to, once it was told', () => {
    const config = { workspaces: 'ws1,ws2' }

    expect(appliesTo(config, 'ws1')).toBe(true)
    expect(appliesTo(config, 'ws3')).toBe(false)
  })

  // A page with no workspace at all: there is nothing to match against, and
  // guessing "yes" would draw in a place the user excluded.
  it('does not apply with no workspace, once a list exists', () => {
    expect(appliesTo({ workspaces: 'ws1' }, '')).toBe(false)
    expect(appliesTo({ workspaces: 'ws1' }, undefined)).toBe(false)
    expect(appliesTo({}, '')).toBe(true)
  })
})

describe('maxChars', () => {
  it('has a default worth having', () => {
    expect(maxChars({})).toBe(DEFAULT_MAX_CHARS)
    expect(maxChars(undefined)).toBe(DEFAULT_MAX_CHARS)
  })

  it('takes a number somebody typed', () => {
    expect(maxChars({ maxChars: 50 })).toBe(50)
    expect(maxChars({ maxChars: '80' })).toBe(80)
    expect(maxChars({ maxChars: 12.7 })).toBe(12)
  })

  // A zero or a negative would refuse every equation, silently, which is not
  // what anybody means by typing one.
  it('ignores a limit that would draw nothing', () => {
    expect(maxChars({ maxChars: 0 })).toBe(DEFAULT_MAX_CHARS)
    expect(maxChars({ maxChars: -5 })).toBe(DEFAULT_MAX_CHARS)
    expect(maxChars({ maxChars: 'lots' })).toBe(DEFAULT_MAX_CHARS)
  })
})

describe('languages', () => {
  /**
   * A ```latex block is as often a whole document as it is an equation, and
   * KaTeX draws none of a preamble. Claiming it by default would turn readable
   * source into a block that refuses to render.
   */
  it('claims GitHub\u2019s fence and nothing else, by default', () => {
    expect(languages({})).toEqual([GITHUB_LANGUAGE])
    expect(languages(undefined)).toEqual(['math'])
  })

  it('claims the tex fences only when asked', () => {
    expect(languages({ tex: true })).toEqual(['math', ...TEX_LANGUAGES])
  })
})

describe('unwrap', () => {
  /**
   * GitHub's ```math fence takes no delimiters — the fence *is* the delimiter.
   * But almost everyone writing one has just come from a `$$…$$` block and
   * writes those too, and left alone they typeset as literal dollar signs,
   * which reads as a mistake in the maths rather than in the markup.
   */
  it('takes off the delimiters people write out of habit', () => {
    expect(unwrap('$$x + 1$$')).toBe('x + 1')
    expect(unwrap('\\[x + 1\\]')).toBe('x + 1')
    expect(unwrap('\\(x + 1\\)')).toBe('x + 1')
    expect(unwrap('$x + 1$')).toBe('x + 1')
  })

  it('takes off exactly one pair, and trims what is inside', () => {
    expect(unwrap('  $$  x + 1  $$  ')).toBe('x + 1')
    // The inner pair is the author's, not a wrapper: taking both off would be
    // guessing at an expression that says something different.
    expect(unwrap('$$$x$$$')).toBe('$x$')
  })

  /**
   * The case that makes this a rule rather than a `startsWith`/`endsWith`:
   * `$$a$$ + $$b$$` begins and ends with `$$` without being wrapped in it, and
   * stripping there would silently change what the equation says.
   */
  it('leaves a delimiter alone when it is not a wrapper', () => {
    expect(unwrap('$$a$$ + $$b$$')).toBe('$$a$$ + $$b$$')
    expect(unwrap('$a$ + $b$')).toBe('$a$ + $b$')
  })

  it('leaves an expression with no delimiters exactly as written', () => {
    expect(unwrap(QUADRATIC)).toBe(QUADRATIC)
    expect(unwrap('a $ b')).toBe('a $ b')
  })

  it('leaves a mismatched pair alone', () => {
    expect(unwrap('\\[x + 1\\)')).toBe('\\[x + 1\\)')
    expect(unwrap('$$x + 1$')).toBe('$$x + 1$')
  })

  // A wrapper with nothing in it is an empty expression, which is a thing to
  // have — and shorter than a wrapper is not a wrapper at all.
  it('handles a string too short to be wrapped in anything', () => {
    expect(unwrap('$$')).toBe('')
    expect(unwrap('$')).toBe('$')
    expect(unwrap('')).toBe('')
    expect(unwrap(undefined)).toBe('')
  })
})

describe('isRefused', () => {
  /**
   * Macros outlive the equation they are written in. KaTeX keeps them in a
   * `macros` object, and where that object is shared — which is how anyone gets
   * `\newcommand` to work across a document — `\gdef` writes into it, so one
   * equation could redefine `\alpha` for every equation drawn after it.
   */
  it('refuses a macro definition, in every spelling of it', () => {
    const macros = [
      '\\def\\x{1}',
      '\\gdef\\x{1}',
      '\\edef\\x{1}',
      '\\xdef\\x{1}',
      '\\newcommand{\\x}{1}',
      '\\renewcommand{\\x}{1}',
      '\\providecommand{\\x}{1}',
      '\\newenvironment{x}{}{}',
      '\\let\\x\\alpha',
      '\\futurelet\\x\\y',
      '\\global\\def\\x{1}',
    ]

    for (const source of macros) expect(isRefused(source), source).toBe(true)
  })

  /**
   * KaTeX gates these behind `trust`: a link, a remote image or an HTML
   * attribute written from inside an equation. A remote image in a message is a
   * tracking pixel with extra steps.
   */
  it('refuses the commands that reach outside the equation', () => {
    const reaching = [
      '\\href{https://example.com}{x}',
      '\\url{https://example.com}',
      '\\includegraphics{x.png}',
      '\\htmlClass{x}{y}',
      '\\htmlId{x}{y}',
      '\\htmlStyle{color:red}{y}',
      '\\htmlData{x=1}{y}',
    ]

    for (const source of reaching) expect(isRefused(source), source).toBe(true)
  })

  /**
   * Matched case-sensitively, because TeX is, and matched to a command
   * boundary. `\definecolor` is not `\def`, and `\Let` is not a command at all
   * — refusing either would turn away ordinary maths for nothing.
   */
  it('does not refuse a longer command that merely starts the same way', () => {
    expect(isRefused('\\definecolor{c}{RGB}{0,0,0}')).toBe(false)
    expect(isRefused('\\letter')).toBe(false)
    expect(isRefused('\\globalize')).toBe(false)
    expect(isRefused('\\Def')).toBe(false)
  })

  it('leaves ordinary maths alone', () => {
    expect(isRefused(QUADRATIC)).toBe(false)
    expect(isRefused('\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}')).toBe(false)
  })
})

describe('renderBlock', () => {
  it('answers with the TeX, for the drawer to typeset', () => {
    expect(renderBlock(QUADRATIC)).toEqual({ type: 'diagram', format: 'math', source: QUADRATIC })
  })

  it('answers with the expression the author meant, not the delimiters', () => {
    expect(renderBlock('$$' + QUADRATIC + '$$').source).toBe(QUADRATIC)
  })

  it('refuses one longer than it was told to draw', () => {
    const long = 'x'.repeat(200)

    expect(renderBlock(long, { maxChars: 100 })).toBeNull()
    expect(renderBlock(long, { maxChars: 500 })).not.toBeNull()
  })

  it('refuses an expression that defines macros or reaches outside itself', () => {
    expect(renderBlock('\\gdef\\alpha{\\beta} \\alpha')).toBeNull()
    expect(renderBlock('\\href{https://example.com}{click}')).toBeNull()
  })

  it('has nothing to draw from nothing', () => {
    expect(renderBlock('')).toBeNull()
    expect(renderBlock('   \n  ')).toBeNull()
    expect(renderBlock(undefined)).toBeNull()
    // A pair of delimiters with nothing between them is also nothing.
    expect(renderBlock('$$$$')).toBeNull()
  })
})

describe('apply', () => {
  const register = (config = {}) => {
    const added = []
    apply({ renderers: { add: (entry) => added.push(entry) } }, config)
    return added
  }

  it('claims the math fence, and nothing else', () => {
    const added = register()

    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ id: 'math', language: 'math', label: 'Math' })
  })

  it('claims the tex fences too, once they are turned on', () => {
    expect(register({ tex: true }).map((entry) => entry.language)).toEqual(['math', 'latex', 'tex'])
  })

  it('answers a fence with a diagram node', () => {
    const [entry] = register()

    expect(entry.run({ source: QUADRATIC })).toEqual({
      nodes: [{ type: 'diagram', format: 'math', source: QUADRATIC }],
    })
  })

  /**
   * Nothing drawn is a legitimate answer: AgentRQ leaves the fence as the text
   * it was, which is exactly what somebody needs in order to see what is wrong
   * with it. An error would replace a readable code block with a complaint.
   */
  it('answers nothing at all for an expression it will not draw', () => {
    const [entry] = register({ maxChars: 5 })

    expect(entry.run({ source: QUADRATIC })).toBeNull()
    expect(entry.run({ source: '\\def\\x{1}' })).toBeNull()
    expect(entry.run({})).toBeNull()
  })

  it('decides for itself which workspaces it applies to', () => {
    const [entry] = register({ workspaces: 'ws1' })

    expect(entry.when({ workspaceId: 'ws1' })).toBe(true)
    expect(entry.when({ workspaceId: 'ws2' })).toBe(false)
    expect(entry.when()).toBe(false)
  })

  it('applies everywhere when it was not told otherwise', () => {
    const [entry] = register()

    expect(entry.when({ workspaceId: 'anything' })).toBe(true)
    expect(entry.when()).toBe(true)
  })

  it('asks for the one registry it uses', async () => {
    const module = await import('../index.js')

    expect(module.inject).toEqual(['renderers'])
    expect(module.name).toBe('math')
  })
})
