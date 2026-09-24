// Croutons: a folder trail where a folder links to whatever page lives at
// that folder's URL. See SPEC.md.

// One lookup per build, keyed on the collections.note array. Eleventy makes
// a fresh array each build, so watch-mode rebuilds never see a stale lookup.
const lookups = new WeakMap();

function warn(message) {
  console.warn(`[plugins] croutons: ${message}`);
}

// Same folder derivation as the core filetree: dg-path (path rewrite rules)
// wins, otherwise the part of filePathStem after the last "/notes/".
function foldersOf(item) {
  const dgPath = item.data["dg-path"];
  let parts = [];
  if (typeof dgPath === "string" && dgPath.length > 0) {
    parts = dgPath.split("/");
  } else {
    const split = (item.filePathStem || "").split("/notes/");
    if (split.length > 1) parts = split[split.length - 1].split("/");
  }
  return parts.slice(0, -1).filter(Boolean);
}

function segmentsOf(url) {
  return url.split("/").filter(Boolean);
}

function urlOf(segments) {
  return "/" + segments.map((s) => s + "/").join("");
}

// The Obsidian publisher nests custom properties under dg-note-properties;
// hand-written gardens may put crouton-label at the top level.
function labelOf(data) {
  const props = data["dg-note-properties"];
  const label = (props && props["crouton-label"]) || data["crouton-label"];
  return typeof label === "string" && label.trim() ? label.trim() : null;
}

function isHome(item) {
  const tags = item.data.tags;
  return Array.isArray(tags) ? tags.includes("gardenEntry") : tags === "gardenEntry";
}

function recordFolders(folderUrls, folders, segments) {
  for (let k = 1; k <= folders.length; k++) {
    const key = folders.slice(0, k).join("/");
    if (!folderUrls.has(key)) folderUrls.set(key, urlOf(segments.slice(0, k)));
  }
}

function buildLookup(notes) {
  const pages = new Map(); // url -> { label, folders }
  const folderUrls = new Map(); // "F1/F2" -> "/s1/s2/"
  const permalinked = [];

  for (const item of notes) {
    if (!item || !item.data || typeof item.url !== "string") continue;
    const folders = isHome(item) ? [] : foldersOf(item);
    pages.set(item.url, { label: labelOf(item.data), folders });
    if (isHome(item) || folders.length === 0) continue;

    const segments = segmentsOf(item.url);
    if (item.data["dg-permalink"] !== undefined) {
      permalinked.push({ folders, segments });
    } else if (segments.length === folders.length + 1) {
      // Plain note: its URL mirrors its folders, already slugified.
      recordFolders(folderUrls, folders, segments);
    }
  }

  // Fallback for folders with no plain notes: a permalinked note whose URL
  // is exactly as deep as its folders. Plain-note evidence already won.
  for (const { folders, segments } of permalinked) {
    if (segments.length === folders.length) recordFolders(folderUrls, folders, segments);
  }

  return { pages, folderUrls };
}

function getLookup(notes) {
  if (!lookups.has(notes)) {
    let lookup = null;
    try {
      lookup = buildLookup(notes);
    } catch (error) {
      warn(`could not build the folder lookup (${error.message}); rendering no trails`);
    }
    lookups.set(notes, lookup);
  }
  return lookups.get(notes);
}

function trail(notes, pageUrl, homeLabel) {
  if (!Array.isArray(notes) || typeof pageUrl !== "string" || pageUrl === "/") return [];
  const lookup = getLookup(notes);
  if (!lookup) return [];
  const { pages, folderUrls } = lookup;

  const croutons = [];
  if (homeLabel) croutons.push({ label: homeLabel, url: "/" });

  const page = pages.get(pageUrl);
  const folders = page ? page.folders : [];
  for (let k = 1; k <= folders.length; k++) {
    const name = folders[k - 1];
    const url = folderUrls.get(folders.slice(0, k).join("/"));
    if (url === pageUrl) continue; // this page is the folder's index
    if (url && pages.has(url)) {
      croutons.push({ label: pages.get(url).label || name, url });
    } else {
      croutons.push({ label: name, url: null });
    }
  }
  return croutons;
}

module.exports = {
  setupEleventy(eleventyConfig) {
    eleventyConfig.addFilter("croutons", function (notes, pageUrl, homeLabel) {
      try {
        return trail(notes, pageUrl, homeLabel);
      } catch (error) {
        warn(`could not build the trail for ${pageUrl} (${error.message})`);
        return [];
      }
    });
  },
};
