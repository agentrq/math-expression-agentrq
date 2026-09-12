import { describe, it, expect } from 'vitest'

import { LANGUAGE, allowedWorkspaces, appliesTo, apply, renderBlock } from '../index.js'

/**
 * This half decides *whether* an expression is drawn, and deliberately decides
 * very little else.
 *
 * GitHub's specification for a ```math fence is "the contents are TeX", and the
 * thing worth testing here is that nothing has been added to it: no length cap,
 * no refused commands, no delimiter rewriting. The guards that matter live in
 * the drawer, where they can be enforced by construction, and are tested there.
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

describe('renderBlock', () => {
  it('answers with the TeX, for the drawer to typeset', () => {
    expect(renderBlock(QUADRATIC)).toEqual({ type: 'diagram', format: 'math', source: QUADRATIC })
  })

  /**
   * GitHub's line is that with the fence "you don't need to use `$$`
   * delimiters" — not that it removes them if you do. Rewriting the expression
   * would be this extension quietly editing somebody's maths, and the cases
   * where it guesses wrong change what the equation says.
   */
  it('leaves delimiters exactly as they were written', () => {
    expect(renderBlock('$$x + 1$$').source).toBe('$$x + 1$$')
    expect(renderBlock('\\[x + 1\\]').source).toBe('\\[x + 1\\]')
    expect(renderBlock('$$a$$ + $$b$$').source).toBe('$$a$$ + $$b$$')
  })

  /**
   * No length cap, no refused commands. An expression GitHub would render is
   * one this draws, and GitHub renders macros — its own documentation says
   * MathJax "supports a wide range of LaTeX macros". What makes that safe is a
   * fresh macro store per render, which is the drawer's job and tested there.
   */
  it('adds no rules of its own to what GitHub accepts', () => {
    expect(renderBlock('\\def\\x{1} \\x')).not.toBeNull()
    expect(renderBlock('\\newcommand{\\R}{\\mathbb{R}} \\R')).not.toBeNull()
    expect(renderBlock('\\href{https://example.com}{x}')).not.toBeNull()
    expect(renderBlock('x'.repeat(20000))).not.toBeNull()
  })

  // Trimmed, because the fence's own whitespace is not part of the expression.
  it('trims the whitespace the fence left behind', () => {
    expect(renderBlock(`\n  ${QUADRATIC}\n`).source).toBe(QUADRATIC)
  })

  /**
   * An empty fence is the one thing with nothing to draw and nothing to report
   * either. An expression that will not *parse* is not refused here — it goes
   * to the drawer, which throws, so the reader sees why rather than a bare code
   * block saying nothing.
   */
  it('has nothing to draw from an empty fence', () => {
    expect(renderBlock('')).toBeNull()
    expect(renderBlock('   \n  ')).toBeNull()
    expect(renderBlock(undefined)).toBeNull()
  })

  it('hands a broken expression on, rather than refusing it', () => {
    expect(renderBlock('\\frac{1}{')).not.toBeNull()
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

    // Not `latex` or `tex`: GitHub renders neither as maths, and a ```latex
    // block is as often a whole document as it is an equation.
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ id: LANGUAGE, language: 'math', label: 'Math' })
  })

  it('answers a fence with a diagram node', () => {
    const [entry] = register()

    expect(entry.run({ source: QUADRATIC })).toEqual({
      nodes: [{ type: 'diagram', format: 'math', source: QUADRATIC }],
    })
  })

  it('answers nothing at all for an empty fence', () => {
    const [entry] = register()

    expect(entry.run({ source: '   ' })).toBeNull()
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

describe('the manifest', () => {
  const manifest = () => import('../agentrq-extension.json', { with: { type: 'json' } })

  it('calls itself what the module calls itself', async () => {
    const [{ default: json }, module] = await Promise.all([manifest(), import('../index.js')])

    // The name is an address — it is how everything else refers to this
    // extension — so a module disagreeing with it means half the wiring points
    // somewhere that does not exist.
    expect(json.name).toBe(module.name)
  })

  it('claims the one fence the module registers', async () => {
    const { default: json } = await manifest()

    expect(json.provides.renderers).toEqual(['math'])
  })

  it('brings its own drawer, because the host draws no maths', async () => {
    const { default: json } = await manifest()

    expect(json.provides.drawers).toEqual([{ format: 'math', entry: 'dist/drawer.js' }])
  })

  it('asks for no MCP tools, because it reads nothing', async () => {
    const { default: json } = await manifest()

    // This extension is handed the text it renders and needs no access to the
    // workspace at all. Its install screen shows no permission list.
    expect(json.mcp).toBeUndefined()
  })
})
