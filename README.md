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

That is the only setting, and the short list is the point — see below.

## GitHub is the specification, and this does not add to it

GitHub's rule for a ```math fence is that the contents are TeX, rendered with
MathJax. **An expression GitHub would render is one this draws.** There is no
length cap, no list of refused commands, and no delimiter rewriting, because
every one of those is a rule somebody has to discover by watching a perfectly
good equation silently fail to render.

Two consequences worth stating outright, because an earlier version of this
extension got both wrong:

**Delimiters are left exactly as written, and drawn.** GitHub says that with the
fence "you don't need to use `$$` delimiters" — not that it strips them if you
do. Checked against MathJax, the engine GitHub renders with: `$$a^2+b^2=c^2$$`
draws the equation *with the dollar signs visible at both ends*. So that is what
this draws too.

Stripping them would be this extension quietly editing somebody's maths, and it
guesses wrong on the cases that matter: `$$a$$ + $$b$$` is two expressions and
an operator, not one expression in dollar signs.

This costs one line of engine compensation, in the drawer. KaTeX and MathJax
disagree here — KaTeX refuses a bare `$` outright with *"Can't use function '$'
in math mode"*, which would make a block anybody writes out of habit fail to
draw. So a bare `$` is escaped to `\$` before KaTeX sees it, which is simply how
a literal dollar is written in TeX. Nothing is removed and no expression is
rewritten to mean something else.

**Macros are not refused.** GitHub's own documentation says MathJax "supports a
wide range of LaTeX macros", and `\def` inside an expression is ordinary TeX
people really write. See below for what makes that safe.

**Only the `math` fence is claimed** — not `latex` or `tex`, which GitHub does
not render as maths either.

## How this draws, and where

The extension is two halves, either side of a boundary.

`index.js` is **scope**, and runs beside the app: which workspaces this applies
to, and nothing else. It answers with the equation's *TeX* and never with
markup.

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

## Nothing is refused — so the guards are structural

Since no expression is turned away for what it *says*, the safety has to come
from how KaTeX is called. It does, and each of these has a test on it.

### Macros are allowed, and cannot escape their equation

KaTeX keeps macros in a `macros` object, and where that object is shared between
renders — which is how anyone gets `\newcommand` to work across a whole document
— `\gdef` writes into it. Checked against KaTeX 0.16.47 rather than assumed:

```js
const macros = {}
katex.renderToString('\\gdef\\alpha{\\text{PWNED}} \\alpha', { macros })
katex.renderToString('\\alpha', { macros })   // → PWNED
```

That is one equation, in one message, redefining `\alpha` for every equation
drawn after it in that window. The fix is not to ban `\def` — GitHub renders it,
and so should this — it is simply to **not share the store**. The drawer builds
a fresh one on every call, so `\def` works inside an expression and is gone by
the next one. `maxExpand` caps how far a macro may unfold, so a short expression
cannot become an enormous one.

### `\href`, `\includegraphics` and the `\html…` commands render inertly

The drawer sets `trust: false`, KaTeX's default and the setting that gates
exactly these. Verified against 0.16.47: `\href` produces no anchor element, and
`\includegraphics` produces no `<img>` and nothing carrying a `src` — KaTeX
renders the command name in its error colour instead. A remote image in a
message is a tracking pixel with extra steps, and none is ever loaded.

Note that an untrusted command does **not** throw: `throwOnError` is about TeX
that will not parse, and these parse fine. So the block still renders, the way
it does on GitHub, rather than refusing to draw.

The URL text does still appear in the output, inside the MathML `<annotation>`
element — the source echoed back for screen readers and copy-paste, which
fetches nothing. Worth knowing, because it means a `.includes('javascript:')`
check on the output returns true for an expression that was handled correctly.
The tests here query for the `<a>` element instead.

### An expression that will not parse is not a refusal

It is an error, and it is reported as one: the drawer throws, and AgentRQ shows
the reason with the TeX underneath it — which is what whoever wrote the equation
needs in order to fix it. An empty fence is the one case that draws nothing at
all, because there is no equation and nothing to report either.

## Where an equation comes from

Usually not from the person reading it. A math block in AgentRQ was typically
written by an agent, or pasted out of an issue, or assembled from a webhook
payload.

That is an argument for the guards being *structural* rather than a list of
banned commands. Untrusted input is exactly the case where a blocklist is worth
least — it has to be complete to work, and a list nobody can prove complete is a
list that gets trusted anyway. So the expression is drawn somewhere that can
reach nothing, with a renderer configured before it is handed anything, and the
equation is free to say whatever it likes in there.

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
