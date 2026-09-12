import { describe, it, expect, beforeEach } from 'vitest'

import draw, { ensureStyles, escapeDollars, fontsReady, katexOptions } from '../src/drawer.js'

/**
 * The drawer is the half that produces markup, so this is where the claims
 * about what it produces have to be *checked* rather than asserted.
 *
 * Every check below queries the parsed DOM — the element, the attribute — and
 * none of them matches a substring. That is not style. KaTeX's `htmlAndMathml`
 * output carries an `<annotation>` element echoing the TeX source verbatim, so
 * `html.includes('\\href')` is true for an expression that was *refused* a link
 * and rendered inert. A substring check there once looked exactly like a broken
 * security guard, and matching `<a>` showed the guard working.
 */

const QUADRATIC = 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'

let root

beforeEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
  root = document.createElement('div')
  document.body.appendChild(root)
})

describe('ensureStyles', () => {
  it('adds the stylesheet to the document', () => {
    expect(ensureStyles(document)).toBe(true)

    const styles = document.head.querySelectorAll('style')
    expect(styles).toHaveLength(1)
    expect(styles[0].textContent).toContain('.katex-display')
  })

  /**
   * The frame is reused across draws — the same document typesets every
   * equation in a message. Half a megabyte of inlined fonts re-added per
   * equation is the difference between a block and a stalled window.
   */
  it('adds it once, however many times it is asked', () => {
    ensureStyles(document)

    expect(ensureStyles(document)).toBe(false)
    expect(ensureStyles(document)).toBe(false)
    expect(document.head.querySelectorAll('style')).toHaveLength(1)
  })

  it('does nothing without a document to add it to', () => {
    expect(ensureStyles(null)).toBe(false)
    expect(ensureStyles(undefined)).toBe(false)
  })
})

describe('katexOptions', () => {
  /**
   * Nothing is refused before an expression reaches the drawer — GitHub renders
   * macros and trust-gated commands, so this does too. These settings are
   * therefore the only guards there are, which is why each one has a test.
   */
  it('does not trust the expression it is given', () => {
    expect(katexOptions().trust).toBe(false)
  })

  it('hands KaTeX a fresh macro store every time', () => {
    const first = katexOptions().macros
    const second = katexOptions().macros

    expect(first).toEqual({})
    // Not merely equal — a *different* object, or `\gdef` in one equation
    // writes into the store the next equation is rendered with.
    expect(first).not.toBe(second)
  })

  it('caps how far a macro may unfold', () => {
    expect(katexOptions().maxExpand).toBe(1000)
  })

  it('throws rather than drawing KaTeX\u2019s own error text', () => {
    expect(katexOptions().throwOnError).toBe(true)
    expect(katexOptions().displayMode).toBe(true)
  })
})

describe('escapeDollars', () => {
  /**
   * GitHub renders with MathJax, which treats `$` inside a math block as an
   * ordinary character and draws it. KaTeX refuses the same input outright, so
   * without this a `$$…$$` block — a habit people bring from every other
   * markdown editor — fails to draw at all.
   */
  it('escapes a bare dollar so KaTeX draws it instead of refusing', () => {
    expect(escapeDollars('$$a^2$$')).toBe('\\$\\$a^2\\$\\$')
    expect(escapeDollars('x = 5$')).toBe('x = 5\\$')
  })

  /**
   * The reason this uses a lookbehind. With `/(^|[^\\])\$/g` the character
   * before each `$` is consumed, so in `$$` the second one is never matched and
   * the expression still fails — which is exactly the input this exists for.
   */
  it('escapes both halves of a doubled delimiter', () => {
    expect(escapeDollars('$$')).toBe('\\$\\$')
    expect(escapeDollars('$$a$$ + $$b$$')).toBe('\\$\\$a\\$\\$ + \\$\\$b\\$\\$')
  })

  it('leaves an already-escaped dollar alone', () => {
    // Escaping it twice would draw a backslash next to the dollar sign.
    expect(escapeDollars('a \\$ b')).toBe('a \\$ b')
    expect(escapeDollars('\\text{cost: \\$5}')).toBe('\\text{cost: \\$5}')
  })

  it('leaves an expression with no dollars untouched', () => {
    expect(escapeDollars('\\frac{1}{2}')).toBe('\\frac{1}{2}')
    expect(escapeDollars('')).toBe('')
  })
})

describe('fontsReady', () => {
  it('waits for the fonts when the document can say', async () => {
    let settled = false
    const doc = { fonts: { ready: Promise.resolve().then(() => (settled = true)) } }

    await fontsReady(doc)
    expect(settled).toBe(true)
  })

  // A test DOM has no `document.fonts`, and a block that waited for one that
  // never arrives would sit on "Drawing…" until the frame timed out.
  it('does not wait for a document that cannot say', async () => {
    await expect(fontsReady({})).resolves.toBeUndefined()
    await expect(fontsReady(undefined)).resolves.toBeUndefined()
  })

  // A font that failed to load is still an equation worth drawing, in whatever
  // face the frame falls back to.
  it('draws anyway when the fonts fail', async () => {
    const doc = { fonts: { ready: Promise.reject(new Error('no fonts')) } }

    await expect(fontsReady(doc)).resolves.toBeUndefined()
  })
})

describe('draw', () => {
  it('typesets an expression into the element it was given', async () => {
    await draw(root, QUADRATIC)

    // The structure KaTeX produces, not the text it contains.
    expect(root.querySelector('.katex')).not.toBeNull()
    expect(root.querySelector('.katex-display')).not.toBeNull()
    // `htmlAndMathml`: the visual typesetting, plus MathML underneath it so the
    // equation can be read by a screen reader and copied as maths.
    expect(root.querySelector('math')).not.toBeNull()
  })

  it('brings the stylesheet with it', async () => {
    await draw(root, QUADRATIC)

    expect(document.head.querySelector('style')).not.toBeNull()
  })

  it('replaces the previous equation rather than adding to it', async () => {
    await draw(root, QUADRATIC)
    await draw(root, 'e^{i\\pi} + 1 = 0')

    expect(root.querySelectorAll('.katex-display')).toHaveLength(1)
  })

  /**
   * The frame catches this and shows the reason with the source underneath,
   * which is what whoever wrote the equation needs in order to fix it.
   */
  it('throws on an expression that will not parse', async () => {
    await expect(draw(root, '\\frac{1}{')).rejects.toThrow()
  })

  it('says so when there is nothing to draw', async () => {
    await expect(draw(root, '')).rejects.toThrow('This equation is empty.')
    await expect(draw(root, '   ')).rejects.toThrow('This equation is empty.')
    await expect(draw(root, undefined)).rejects.toThrow('This equation is empty.')
  })

  /**
   * A failed redraw keeps the last equation that worked, because
   * `renderToString` throws before anything is cleared. A block that blanked on
   * a typo would lose the equation the author was editing.
   */
  it('leaves the last good equation up when a redraw fails', async () => {
    await draw(root, QUADRATIC)
    await expect(draw(root, '\\frac{1}{')).rejects.toThrow()

    expect(root.querySelector('.katex')).not.toBeNull()
  })

  /**
   * The bug testing found: this block used to throw rather than draw.
   *
   * `$$…$$` inside a ```math fence is what people write out of habit. GitHub
   * draws it — the equation, with the dollar signs visible at both ends — and
   * now so does this.
   */
  it('draws an expression somebody wrapped in dollar signs', async () => {
    await draw(root, '$$a^2 + b^2 = c^2$$')

    expect(root.querySelector('.katex')).not.toBeNull()
    // The dollars are drawn, not silently deleted: four of them, as written.
    // An earlier version of this extension stripped them, which changed what
    // `$$a$$ + $$b$$` said.
    const visible = root.querySelector('.katex-html')
    expect(visible.textContent.match(/\$/g)).toHaveLength(4)
  })

  /**
   * Macros are allowed, and this is the test that makes that safe.
   *
   * GitHub renders `\def` and `\newcommand`, so this does too rather than
   * leaving the block as raw text. The danger was never the command — it is a
   * *shared* macro store, which is how `\gdef` in one message could redefine a
   * symbol for every equation drawn after it. A fresh store per call is the
   * whole guard, so it is worth proving rather than asserting.
   */
  it('draws a macro defined inside the expression', async () => {
    await draw(root, '\\def\\R{\\mathbb{R}} \\R')

    expect(root.querySelector('.katex')).not.toBeNull()
  })

  it('does not let a macro escape into the next equation', async () => {
    await draw(root, '\\gdef\\alpha{\\text{LEAKED}} \\alpha')
    // `\alpha` on its own, in a separate draw. If the store were shared this
    // would render the redefinition instead of the Greek letter.
    await draw(root, '\\alpha')

    expect(root.textContent).not.toContain('LEAKED')
  })

  /**
   * The guard that matters, checked by structure.
   *
   * `trust: false` makes KaTeX render `\href` as inert text rather than a link.
   * The TeX source is echoed inside the MathML `<annotation>` element, so the
   * characters are present either way — what decides it is whether an anchor
   * element exists, and whether anything carries a `javascript:` URL.
   */
  it('produces no link from an expression asking for one', async () => {
    await draw(root, '\\href{javascript:alert(1)}{click me}')

    expect(root.querySelectorAll('a')).toHaveLength(0)
    for (const element of root.querySelectorAll('*')) {
      for (const attribute of element.attributes) {
        expect(attribute.value.toLowerCase()).not.toContain('javascript:')
      }
    }
  })

  /**
   * A remote image in a message is a tracking pixel with extra steps, and this
   * is where that is actually settled.
   *
   * Untrusted commands do **not** throw — `throwOnError` is about TeX that will
   * not parse, and `\includegraphics` parses fine. KaTeX renders the command
   * name in its error colour instead, and the URL survives only inside the
   * MathML `<annotation>`, which is an echo of the source and fetches nothing.
   * So the check is that no element loads anything: no `<img>`, and no `src` on
   * anything else either.
   */
  it('loads no image from an expression asking for one', async () => {
    await draw(root, '\\includegraphics[width=1in]{https://example.com/pixel.png}')

    expect(root.querySelectorAll('img')).toHaveLength(0)
    for (const element of root.querySelectorAll('*')) {
      expect(element.hasAttribute('src')).toBe(false)
    }
  })
})
