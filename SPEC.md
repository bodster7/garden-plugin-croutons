# Croutons — Specification (v1)

A Digital Garden plugin that renders a folder trail ("croutons") in each note's header, below the title and tags, where a folder crouton becomes a **link** whenever a page exists at that folder's URL.

Inspired by [Breadcrumbs](https://github.com/oleeskild/garden-plugin-breadcrumbs) by Ole Eskild Steensen. **Clean-room implementation**: the upstream repo has no licence file, so no upstream code is copied.

- Repo: `garden-plugin-croutons` (standalone, public)
- Plugin id: `croutons`
- Licence: MIT (copyright Ian Henderson)
- Author: Ian

---

## 1. Why

Upstream Breadcrumbs shows `Home / Projects / Meshcore`, but only `Home` is a link, because folders have no pages. Gardens that publish a folder "index" note (e.g. `Projects/Meshcore/Meshcore - README.md` with `dg-permalink: projects/meshcore`) *do* have a page at the folder URL. Croutons detects this and links the crouton.

Side effect: **hackable URLs**. Deleting the last segment of `/projects/meshcore/some-plans/` lands on a real page, and the trail makes that visible.

The mechanism is convention-agnostic. It doesn't care about file names (`- README`, `index`, `projects.md`) or how a page got to a URL. If a page exists at the folder's URL, the crouton links to it. This also means the common "folder note" convention (`Projects/Meshcore.md` beside the folder) works for free.

---

## 2. Step zero — dev environment (Windows)

Before any plugin work, the local garden must build.

1. `git pull` in the garden repo. The Obsidian DG plugin publishes by committing to GitHub, so local copies drift.
2. `npm install` after every template update. A stale `node_modules` gives errors like `'npm-run-all' is not recognized`.
3. `npm run dev`. If it fails with no useful message, run `npm run watch:eleventy` alone; `npm-run-all` hides child errors.
4. On `EBUSY: resource busy or locked` (favicon copy race on Windows): `rmdir /s /q dist` and `rmdir /s /q .cache`, then retry. If persistent, add a Windows Defender exclusion for the repo folder.

Working practice:

- Develop on a branch (`croutons-dev`) in the garden repo. Don't push it unless the host is known not to deploy branches.
- The plugin lives in its **own** repo, developed in place: `<garden>/src/plugins/croutons/` *is* the plugin's git repo, and that path is in the garden's `.gitignore`. Symlinks and Windows junctions do **not** work: the loader discovers plugins with `readdirSync(..., { withFileTypes: true }).filter(e => e.isDirectory())`, which skips links silently.
- Disable upstream `breadcrumbs` in `src/plugins/plugins.json` to avoid two stacked trails.
- Template and style edits hot-reload. **Hook and manifest changes need a restart.**
- Install the plugin API skill for the agent: `npx skills add oleeskild/digitalgarden` (installs as `garden-plugin-author` under `.agents/skills/`). Treat it, and the garden's own `src/helpers/pluginLoader.js`, as the authority on hook signatures, slot data and manifest schema. Where this spec disagrees, they win. (This spec was corrected against both on 2026-09-25.)

---

## 3. Repo layout

```
garden-plugin-croutons/
├── garden-plugin.json
├── index.js              # hook: registers the filter that builds + caches the lookup
├── templates/trail.njk   # notes.header slot
├── styles/croutons.scss
├── README.md
├── LICENSE               # MIT
├── SPEC.md               # this file
└── screenshot.png
```

Keep total code small enough that a cautious user will read it before installing (an ecosystem "good citizen" rule). No install-time steps; installation is pure file copying.

---

## 4. Manifest (shape; verify against the skill)

```json
{
  "id": "croutons",
  "name": "Croutons",
  "version": "0.1.0",
  "description": "Folder trail above the title, with folder croutons linking to folder index pages.",
  "author": "Ian",
  "hooks": "index.js",
  "slots": { "notes.header": "templates/trail.njk" },
  "styles": ["styles/croutons.scss"],
  "settings": [
    { "key": "homeLabel", "name": "Home label",
      "description": "First crouton, linking to the home page. Leave empty to hide it.",
      "type": "text", "default": "Home", "env": "CROUTONS_HOME_LABEL" },
    { "key": "separator", "name": "Separator", "type": "text", "default": "/",
      "env": "CROUTONS_SEPARATOR" }
  ]
}
```

Settings deliberately match upstream Breadcrumbs so switching over is painless. No other settings in v1.

Resolution order (loader): value in `src/plugins/plugins.json` → env var → `default`. Without `env`, the loader falls back to an env var named after the key (`separator`, `homeLabel`), which is too generic; the explicit `env` names avoid accidental overrides. An empty string stored in `plugins.json` is respected. Templates read `pluginSettings.<key>`; hooks read `context.settings.<key>`.

---

## 5. Frontmatter

| Key | Where | Effect |
|---|---|---|
| `dg-permalink` | any note | Standard DG. Placing a page at a folder's URL makes it that folder's index. |
| `crouton-label` | a folder index page | Replaces the folder name in every trail that passes through that folder. Plain text only (escaped), e.g. `crouton-label: "Meshcore 🛰️"`. Ignored on non-index pages. |

**Where `crouton-label` actually lands:** the Obsidian DG publisher does not pass custom properties through as top-level frontmatter. It nests them under `dg-note-properties` (e.g. `{"dg-permalink": "projects/meshcore", "permalink": "/projects/meshcore/", "dg-note-properties": {"bite": "…"}}`), and only when the publisher's note-properties option is on. Read `data["dg-note-properties"]["crouton-label"]` first, then fall back to top-level `data["crouton-label"]` for hand-written frontmatter.

The Home crouton's text always comes from the `homeLabel` setting, never from `crouton-label`.

---

## 6. Behaviour

### 6.1 Terms

- **Folders of a note**: path segments between the notes root (`src/site/notes/`) and the file name. `Projects/Meshcore/Some plans.md` gives `["Projects", "Meshcore"]`. Derive them exactly as the core file tree does (`src/helpers/filetreeUtils.js`): from `data["dg-path"]` when set (path-rewrite rules), otherwise from the part of `filePathStem` after the **last** `/notes/`; drop the final segment (the file).
- **Plain note**: a note with no `dg-permalink` key. Note that *every* published note has a `permalink` in its frontmatter (the Obsidian publisher writes it, e.g. `"/projects/meshcore/some-plans/"`), so "has a permalink" is not the test. A plain note's URL mirrors its folders, already slugified by the publisher.
- **Folder URL**: the real URL prefix a folder maps to, e.g. `Projects/Meshcore` maps to `/projects/meshcore/`.

### 6.2 Per-build lookup (built once per build, by the filter)

Hooks run at config time and never see the notes (`setupEleventy(eleventyConfig, { settings, manifest, pluginDir })`). So the hook only registers a filter, e.g. `collections.note | croutons(page)`, called from the slot template. On its first call in a build, the filter makes a single pass over `collections.note` (`item.url`, `item.filePathStem`, `item.data`) to build:

1. **`pages: Map<url, { label }>`**: every note's URL, with its `crouton-label` if set.
2. **`folderUrls: Map<folderPath, url>`**: learned from **plain notes only**. For a plain note with folders `[F1..Fn]` and URL segments `[s1..sn, leaf]`, record `F1..Fk` → `/s1/…/sk/` for every k ≤ n. This uses DG's own slugification, so there is no second slugifier and no drift between two implementations.
   - Fallback for folders with no plain notes (e.g. a folder containing only its README): a note **with** `dg-permalink` whose URL has exactly `n` segments may supply `F1..Fn` → its URL, but only for entries not already known from plain notes. Plain-note evidence always wins.
   - **Exclude the home note** (tag `gardenEntry`). Its URL is forced to `/` regardless of its folders, so it would teach wrong mappings if it lived in a folder. It still goes into `pages` as `/`.

**Cache invalidation**: in `--serve` mode the lookup must be rebuilt on every rebuild, not once per process. Key the cache on the `collections.note` array in a `WeakMap`. Eleventy creates a fresh array each build, so the cache invalidates itself; this is the same pattern as the core's `getFileTree`. (A per-build event does not work: `eleventy.before` fires before collections exist.) Stale caches cause "I added a README and nothing changed" bugs.

### 6.3 Building a note's trail

```
if page.url == "/": render nothing                      # defensive: notes.header never renders on the home page (it uses index.* slots)

croutons = []
if homeLabel != "": croutons.push(link("/", homeLabel))

for each ancestor folder F (outermost first):
    url = folderUrls.get(F)
    if url == page.url: continue                         # this page IS F's index → drop (6.4)
    if url && pages.has(url):
        croutons.push(link(url, pages.get(url).label ?? name(F)))
    else:
        croutons.push(plain(name(F)))

if croutons is empty: render nothing                     # no croutons, no <nav>
```

### 6.4 Rules and edge cases

| Page | Trail |
|---|---|
| Home page (`Welcome.md`, URL `/`) | none |
| Root-level note (`dataview experiment.md`) | Home |
| Root-level note, `homeLabel` empty | none (no empty `<nav>`) |
| `Projects/Meshcore/Some plans.md` | Home / Projects🔗 / Meshcore🔗 |
| `Projects/Meshcore/Meshcore - README.md` (the Meshcore index) | Home / Projects🔗 (own folder dropped, since the title is right below) |
| `Musings/20260916 2153.md` (no `/musings/` page) | Home / Musings (plain) |
| Note with a custom `dg-permalink` not under its folder's URL, e.g. `Projects/Meshcore/Roadmap.md` → `/meshcore-roadmap/` | Folder croutons still resolve through `folderUrls`, so links stay correct. Emit one `[plugins]` warning naming the note, so the author knows its URL doesn't follow its folders. |
| Folder whose URL can't be learned at all | That crouton is plain. No warning needed. |

The current page is **never** shown as a crouton.

### 6.5 Warnings

- Channel: `[plugins]` build log lines, written with `console.warn("[plugins] croutons: …")` (the loader's own `warn()` is not exported). Never throw; a misbehaving plugin must not break the build. Wrap the filter body so any error yields no trail rather than a failed render.
- At most one warning per note per build: emit warnings while building the lookup (once per build, 6.2), not per render. No warnings on a vanilla garden.

---

## 7. Markup

```html
<nav class="croutons" aria-label="Breadcrumb">
  <ol>
    <li class="crouton crouton--link"><a href="/">Home</a><span class="crouton-sep" aria-hidden="true">/</span></li>
    <li class="crouton crouton--link"><a href="/projects/">Projects</a><span class="crouton-sep" aria-hidden="true">/</span></li>
    <li class="crouton crouton--plain">Musings</li>
  </ol>
</nav>
```

- `nav` + `aria-label` + `ol`/`li` so screen readers announce a breadcrumb list.
- The separator is the `separator` setting, rendered in a span with `aria-hidden="true"`, and not output after the last crouton.
- All labels are escaped (folder names and `crouton-label` are user content).
- `crouton--link` / `crouton--plain` classes let themes distinguish unlinked folders.

---

## 8. Styling

- Default CSS styles `--link` and `--plain` **identically**, so the out-of-box look matches upstream.
- Horizontal inline list, wraps on narrow screens, inherits theme colours via existing garden CSS variables where possible (e.g. `--text-muted`, `--font-ui-small`).
- Sits inside the note `<header>` after the title and tags (the `notes.header` slot). Don't reorder the core layout to push it above the title.
- Respect light/dark themes; no hard-coded colours if a variable exists.

---

## 9. Performance

- Build the lookup once per build (6.2); templates only do map lookups.
- No per-page iteration over the whole collection in Nunjucks (that's O(N²) at build time).
- No client-side JavaScript. Croutons is pure build-time HTML + CSS.

---

## 10. Test cases

**Bodster garden (positive + negative, real data):**

- [ ] `/projects/meshcore/some-plans/` → Home🔗 / Projects🔗 / Meshcore🔗
- [ ] `/projects/meshcore/` (README) → Home🔗 / Projects🔗, with no Meshcore crouton
- [ ] `/projects/` (`projects.md`) → Home🔗, with no Projects crouton
- [ ] `/projects/lora-aprs/` (README only in its folder) → Home🔗 / Projects🔗 (exercises the 6.2 fallback)
- [ ] Any Musings note → Home🔗 / Musings (plain, class `crouton--plain`)
- [ ] `dataview experiment` (root) → Home🔗
- [ ] `/` → no trail, no `<nav>` in the HTML
- [ ] Set `crouton-label: "Meshcore 🛰️"` on the Meshcore README → label appears on every Meshcore child page
- [ ] Set `homeLabel` to empty → root-level notes render no `<nav>`
- [ ] Set `separator` to `›` → rendered, still `aria-hidden`
- [ ] Add a temporary note with a custom `dg-permalink` outside its folder → correct links plus exactly one warning
- [ ] While `npm run dev` is running, edit an existing folder index note (e.g. set or change its `crouton-label`) → every trail through that folder updates without a restart (cache invalidation). Newly *created* notes are not a valid test here: the dev server's watcher doesn't pick up added files until a restart, independent of Croutons.

**Vanilla garden template (fresh clone, "someone who isn't me"):**

- [ ] Plugin installs via *Install from GitHub* with no extra steps
- [ ] All folder croutons render plain, with no errors or warnings
- [ ] Works alongside the core plugins; toggling it off removes the trail cleanly

---

## 11. Out of scope for v1

- Strict mode (`requireExplicitPermalink`). Dropped: it only guards against a problem nobody has.
- Slugifying folder paths inside the plugin. Superseded by `folderUrls` learned from plain notes.
- Showing the current page as the last crouton.
- Markdown or HTML inside `crouton-label`.

---

## 12. Publishing

1. Public repo `garden-plugin-croutons`, with `garden-plugin.json` at the root.
2. Tag releases matching the manifest version (`git tag v0.1.0 && git push --tags`). Installs prefer the latest release.
3. `v0.1.0`: when it runs on bodster.com.
4. `v1.0.0`: after it has lived on bodster.com for a while and passed the vanilla-garden tests.
5. Gallery: PR one entry to `oleeskild/digitalgarden-plugins` → `community-plugins.json` (id, name, author, description, repo, screenshot).
6. Courtesy: open an issue on upstream Breadcrumbs describing the permalink-matching idea and linking Croutons.

README must cover: what it does, the folder-index idea with an example, both settings, `crouton-label`, the CSS classes, the "disable Breadcrumbs first" note, and credit to upstream.
