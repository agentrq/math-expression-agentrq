# Math Expressions for AgentRQ

Draws ```math blocks in tasks and messages as typeset equations, the way GitHub
does, with a toggle back to the TeX.

````markdown
```math
\left( \sum_{k=1}^n a_k b_k \right)^2 \leq \left( \sum_{k=1}^n a_k^2 \right) \left( \sum_{k=1}^n b_k^2 \right)
```
````

Every equation carries a **Text** / **Diagram** toggle, so the TeX is always one
click away — which matters, because an equation is written by hand and the
source is what you need in order to fix it.

## Which of GitHub's four forms this draws

GitHub writes maths [four ways][gh]. AgentRQ hands extensions **fenced blocks**,
by language — that is the whole seam — so this draws the fence and nothing else:

| GitHub form | Here |
|---|---|
| ` ```math ` fence | **drawn** |
| `$$ … $$` block | not drawn — never reaches an extension |
| `$ … $` inline | not drawn |
| `` $`…`$ `` inline | not drawn |

The three it cannot reach are a host change, not an extension one: they need a
seam in AgentRQ's markdown splitter, which today only cuts on fences. Writing
the fence is the portable answer in the meantime, and it is the one GitHub
recommends for anything standing on its own line anyway.

[gh]: https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/writing-mathematical-expressions

## Installing

Extensions are a desktop feature. In the AgentRQ desktop app:

**Extensions → Install from folder**, then pick this repository.

It asks for **no permissions at all** — no workspace tools, no account tools, no
network. It is handed the text of a fenced block and answers with an equation;
it reads nothing else. The install screen shows no permission list, only the
sentence AgentRQ puts on every install about extensions running with full access
to your computer.

Requires **AgentRQ 0.6 or newer** — the release that can draw a `math` diagram.
On 0.5 a math node is *rejected* rather than ignored, so the engine floor is
what stops this installing somewhere it could only fail.

## Settings

| Setting | Default | What it does |
|---|---|---|
| Only these workspaces | blank | Comma-separated workspace ids. Blank draws equations everywhere; a list draws them in those workspaces and nowhere else. |
| Longest expression to draw | 4000 characters | A longer one is left as text. The parser runs in the window you are reading in. Characters rather than lines, because an equation is frequently one very long line. |
| Also draw latex and tex blocks | off | A ```latex block is as often a whole document — `\documentclass`, a preamble, `\begin{document}` — as it is an equation, and KaTeX draws none of that. Off by default so readable source is not turned into a block that refuses to render. |

## Delimiters come off, rather than being required

GitHub's ```math fence takes no delimiters — the fence *is* the delimiter. But
almost everybody writing one has just come from a `$$…$$` block and writes those
too, and left alone they draw as literal dollar signs in front of the equation,
which reads as a typo in the maths rather than in the markup.

So one matched wrapper comes off: `$$…$$`, `\[…\]`, `\(…\)` or `$…$`.

Only when it is unambiguous. `$$a$$ + $$b$$` starts and ends with `$$` without
being wrapped in it, and stripping there would silently turn two expressions and
an operator into one nonsense one — so a middle containing the delimiter again
is left exactly as written.

## How this draws, and where

The extension is two halves, either side of a boundary.

`index.js` is **policy**, and runs beside the app: which workspaces, how much
expression, which delimiters come off, what is refused. It answers with the
equation's *TeX* and never with markup.

`src/drawer.js` is **typesetting**, and runs nowhere near the app. AgentRQ 0.6
gives an extension a sandboxed frame with an opaque origin and this policy:

```
default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:;
font-src data:; connect-src 'none'
```

KaTeX runs in there. Markup it produces stays in a document with no network, no
parent and no bridge to the app — so the `innerHTML` in the drawer is safe for
the reason the frame exists, not because something sanitised it afterwards.

This is why the extension can draw at all. Before 0.6 no extension could produce
markup anywhere, because AgentRQ's renderer sits on a privileged `app://` origin
with a bridge to files, the clipboard and the shell. The rule has not been
relaxed; the frame is simply somewhere the rule does not need to apply.

### The fonts travel in the bundle

`font-src data:` and no network means KaTeX's stylesheet — which asks for twenty
font files by relative URL — would fetch exactly nothing. An equation would
still lay out, because the metrics are in the CSS, but every glyph would be the
wrong shape at the right size, which reads as a rendering bug rather than a
missing font.

So `scripts/build.mjs` inlines all twenty as `data:` URIs. The woff and ttf
copies of each face are stripped first, since the frame is Chromium and takes
the woff2 every time — that is 800 KB not shipped. The bundle is **621 KB**,
served from a URL and cached once by the browser rather than handed to each
frame.

## What is refused before it is ever drawn

### Macro definitions are refused

`\def`, `\gdef`, `\edef`, `\xdef`, `\newcommand`, `\renewcommand`,
`\providecommand`, `\newenvironment`, `\let`, `\futurelet`, `\global`.

KaTeX keeps macros in a `macros` object, and where that object is shared between
renders — which is how anyone gets `\newcommand` to work across a document —
`\gdef` writes into it. Checked against KaTeX 0.16.47 rather than assumed:

```js
const macros = {}
katex.renderToString('\\gdef\\alpha{\\text{PWNED}} \\alpha', { macros })
katex.renderToString('\\alpha', { macros })   // → PWNED
```

One equation, in one message, redefining `\alpha` for every equation drawn after
it in that window. Macros are also how a small expression becomes an enormous
one; KaTeX caps expansion at `maxExpand`, and this is the second guard.

### `\href`, `\url`, `\includegraphics` and the `\html…` commands are refused

KaTeX gates these behind its `trust` option: a link, a remote image, or an HTML
attribute, written from inside an equation. A remote image in a message is a
tracking pixel with extra steps.

The drawer sets `trust: false`, which is already enough — verified against
0.16.47 rather than assumed. `\href` produces no anchor element, and
`\includegraphics` produces no `<img>` and nothing carrying a `src`; KaTeX
renders the command name in its error colour instead. Note that an untrusted
command does **not** throw: `throwOnError` is about TeX that will not parse, and
these parse fine.

The URL text does still appear in the output, inside the MathML `<annotation>`
element — that is the source echoed back for screen readers and copy-paste, and
it fetches nothing. Worth knowing, because it means a `.includes('javascript:')`
check on the output returns true for an expression that was correctly refused.
The tests here query for the `<a>` element instead.

Refusing the commands in `index.js` as well makes two guards that fail
differently: one is configuration a later refactor could change, the other is a
rule with a test on it.

### Near misses are not refused

`\left`, `\deg`, `\urcorner` and the rest merely *start* like a refused command.
Matching is case-sensitive, because TeX is, and bounded on the command name, so
`\left( x \right)` draws — which most real equations depend on.

### A refusal is not an error

The block stays as the text it was, which is exactly what somebody needs in
order to see what is wrong with it. Replacing a readable code block with a
complaint about it helps nobody.

## Where an equation comes from

Usually not from the person reading it. A math block in AgentRQ was typically
written by an agent, or pasted out of an issue, or assembled from a webhook
payload. That is why the source is refused rather than sanitised, why KaTeX is
configured before it can be asked to draw, and why the drawing happens somewhere
that can reach nothing.

## Developing

```bash
npm install
npm run build            # bundles the drawer, fonts and all, into dist/
npm test
npm run test:coverage    # gates at 100%, the same bar AgentRQ holds
```

`dist/` is built, not committed. `npm pack` runs the build first, so the
published tarball carries the drawer.

Installed from a folder, the install is **linked** — editing this directory
edits the installed extension, so a change is one reload away.

## Licence

Apache 2.0. See [LICENSE](LICENSE).
