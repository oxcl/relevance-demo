// shared/types.ts
var ENGINE_VERSION = "1.3.4";

// engine/build.ts
import { copyFileSync, existsSync as existsSync4, mkdirSync as mkdirSync3, readdirSync as readdirSync2, readFileSync as readFileSync3, renameSync, rmSync, statSync, writeFileSync as writeFileSync2 } from "node:fs";
import { createHash as createHash2 } from "node:crypto";
import { deflateSync } from "node:zlib";
import { join as join2, resolve } from "node:path";

// shared/logic.ts
function compareVersions(a, b) {
  let pa = String(a).replace(/^v/i, "").split(/[^0-9a-z]+/i).filter(Boolean), pb = String(b).replace(/^v/i, "").split(/[^0-9a-z]+/i).filter(Boolean), n = Math.max(pa.length, pb.length);
  for (let i = 0;i < n; i++) {
    let x = pa[i], y = pb[i];
    if (x === void 0)
      return -1;
    if (y === void 0)
      return 1;
    let nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) {
      let d = Number(x) - Number(y);
      if (d !== 0)
        return d;
    } else if (nx !== ny)
      return nx ? 1 : -1;
    else {
      let c = x.localeCompare(y);
      if (c !== 0)
        return c;
    }
  }
  return 0;
}
var sortVersionsDesc = (v) => [...new Set(v)].sort((a, b) => compareVersions(b, a));
function findPatch(index, name, pkg) {
  if (!index)
    return;
  let same = index.patches.filter((p) => p.name === name);
  return same.find((p) => p.packages?.some((c) => c.packageName === pkg)) || same.find((p) => !p.packages || p.packages.length === 0) || same[0];
}
function versionsFor(p, pkg) {
  if (!p.packages || p.packages.length === 0)
    return null;
  let c = p.packages.find((c) => c.packageName === pkg);
  if (!c)
    return [];
  return c.versions && c.versions.length ? c.versions : null;
}
function pickTarget(index, pkg, selected, available, pin) {
  if (pin)
    return { supported: null, target: pin, reason: `Pinned to ${pin}` };
  let set = null;
  for (let s of selected) {
    let def = findPatch(index, s.name, pkg);
    if (!def)
      continue;
    let v = versionsFor(def, pkg);
    if (v === null)
      continue;
    set = set === null ? [...v] : set.filter((x) => v.includes(x));
  }
  if (set !== null && set.length === 0)
    return { supported: [], target: null, reason: "The selected patches have no app version in common", conflict: !0 };
  if (set === null)
    return { supported: null, target: available?.length ? sortVersionsDesc(available)[0] : null, reason: "Selected patches work with any version — using the latest" };
  let supported = sortVersionsDesc(set);
  if (!available)
    return { supported, target: supported[0], reason: "Newest version supported by all selected patches" };
  let avail = available.map(String), hit = supported.find((v) => avail.includes(v));
  if (!hit)
    return {
      supported,
      target: supported[0],
      reason: `Version ${supported[0]} is supported but the source may not provide it`
    };
  return { supported, target: hit, reason: "Newest version supported by all selected patches" };
}
function needsRebuild(app) {
  if (app.tool !== "none")
    return !0;
  let c = app.customize || {};
  return Boolean(c.name || c.packageName || c.icon);
}
async function configHash(app) {
  let relevant = {
    source: app.source,
    tool: app.tool,
    patchSourceId: app.patchSourceId,
    patches: [...app.patches].sort((a, b) => a.name.localeCompare(b.name)),
    customPatches: app.customPatches.filter((c) => c.enabled),
    customize: app.customize,
    pin: app.pin ?? null
  }, data = (/* @__PURE__ */ new TextEncoder()).encode(stableStringify(relevant)), digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
function stableStringify(v) {
  if (v === null || typeof v !== "object")
    return JSON.stringify(v ?? null);
  if (Array.isArray(v))
    return `[${v.map(stableStringify).join(",")}]`;
  let o = v;
  return `{${Object.keys(o).filter((k) => o[k] !== void 0).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}
function b64urlEncode(bytes) {
  let s = "";
  for (let b of bytes)
    s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function encodeRecipe(r) {
  return b64urlEncode((/* @__PURE__ */ new TextEncoder()).encode(JSON.stringify(r)));
}
function recipeFromApp(app, patchSource) {
  return {
    v: 1,
    name: app.name,
    packageName: app.packageName,
    source: app.source.type === "upload" ? { ...app.source } : { ...app.source },
    tool: app.tool,
    patchSource,
    patches: app.patches,
    customPatches: app.customPatches,
    customize: {
      name: app.customize.name,
      packageName: app.customize.packageName,
      iconEdit: app.customize.icon?.mode === "edit" ? app.customize.icon.edit : void 0
    }
  };
}
function formatBytes(n) {
  if (!n && n !== 0)
    return "—";
  if (n < 1024)
    return `${n} B`;
  if (n < 1048576)
    return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// shared/sources.ts
var PKG_RE = /^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/;
function sourceAutoUpdates(t) {
  return t === "apkpure" || t === "fdroid" || t === "github";
}
function ua(ctx) {
  return { "User-Agent": ctx.userAgent || "Relevance (+https://github.com/oxcl/relevance)" };
}
function decodeHtml(s) {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}
function parseGithubRepo(url) {
  let m = url.match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
  if (!m)
    return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
}
async function gh(ctx, path) {
  let headers = { Accept: "application/vnd.github+json", ...ua(ctx) };
  if (ctx.githubToken)
    headers.Authorization = `Bearer ${ctx.githubToken}`;
  let r = await ctx.fetch(`https://api.github.com${path}`, { headers });
  if (!r.ok)
    throw Error(`GitHub API ${r.status} for ${path}`);
  return r.json();
}
async function githubReleases(ctx, src) {
  let r = parseGithubRepo(src.url);
  if (!r)
    throw Error("Not a GitHub repository URL");
  let rels = await gh(ctx, `/repos/${r.owner}/${r.repo}/releases?per_page=30`);
  return { repo: r, releases: rels.filter((x) => !x.draft && (src.prerelease || !x.prerelease)) };
}
function pickAsset(rel, pattern) {
  let re = new RegExp(pattern || "\\.apk$", "i");
  return (rel.assets || []).find((a) => re.test(a.name)) || (rel.assets || []).find((a) => /\.apk$/i.test(a.name));
}
var tagVersion = (t) => t.replace(/^[^0-9]*/, "") || t;
async function resolveSource(src, ctx) {
  switch (src.type) {
    case "github": {
      let { repo, releases } = await githubReleases(ctx, src), meta = await gh(ctx, `/repos/${repo.owner}/${repo.repo}`).catch(() => ({})), withApk = releases.filter((r) => pickAsset(r, src.assetPattern)), latest = withApk[0] || releases[0];
      return {
        name: meta.name || repo.repo,
        summary: meta.description || void 0,
        website: meta.homepage || meta.html_url,
        iconUrl: meta.owner?.avatar_url,
        versions: withApk.map((r) => tagVersion(r.tag_name)),
        latest: latest ? tagVersion(latest.tag_name) : void 0,
        assets: (latest?.assets || []).map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url })),
        size: latest ? pickAsset(latest, src.assetPattern)?.size : void 0,
        autoUpdates: !0
      };
    }
    case "fdroid": {
      let pkg = fdroidPackage(src.url);
      if (!pkg)
        throw Error("Could not find a package name in the F-Droid URL");
      let api = await (await ctx.fetch(`https://f-droid.org/api/v1/packages/${pkg}`, { headers: ua(ctx) })).json(), html = await (await ctx.fetch(`https://f-droid.org/en/packages/${pkg}/`, { headers: ua(ctx) })).text().catch(() => ""), name = decodeHtml(html.match(/<h3 class="package-name">\s*([^<]+?)\s*<\/h3>/)?.[1] || "") || pkg, summary = decodeHtml(html.match(/<div class="package-summary">\s*([^<]+?)\s*<\/div>/)?.[1] || ""), desc = html.match(/<div class="package-description">([\s\S]*?)<\/div>/)?.[1]?.trim(), icon = html.match(/<img class="package-icon" src="([^"]+)"/)?.[1], shots = [...html.matchAll(/<img class="screenshot"[^>]*src="([^"]+)"/g)].map((m) => new URL(m[1], "https://f-droid.org").href), versions = (api.packages || []).map((p) => p.versionName);
      return {
        packageName: pkg,
        name,
        summary: summary || void 0,
        description: desc,
        iconUrl: icon ? new URL(icon, "https://f-droid.org").href : void 0,
        screenshots: shots,
        website: `https://f-droid.org/packages/${pkg}/`,
        versions,
        latest: (api.packages || []).find((p) => p.versionCode === api.suggestedVersionCode)?.versionName || versions[0],
        autoUpdates: !0
      };
    }
    case "apkpure": {
      let { pkg, page } = apkpurePage(src.url), res = await ctx.fetch(page, { headers: ua(ctx), redirect: "follow" });
      if (!res.ok && !(res.status === 403 && ctx.resolver))
        throw Error(`APKPure responded ${res.status}`);
      let html = res.ok ? await res.text() : "", ld = null;
      for (let m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g))
        try {
          let j = JSON.parse(m[1]), flat = (x) => Array.isArray(x) ? x.flatMap(flat) : x && typeof x === "object" ? [x, ...flat(x["@graph"] || [])] : [];
          ld = flat(j).find((x) => [].concat(x["@type"] || []).some((t) => /Application$/.test(t))) || ld;
        } catch {}
      let name = (ld?.name || decodeHtml(html.match(/<h1[^>]*>\s*([^<]+?)\s*</)?.[1] || "") || pkg).trim(), latest = [...html.matchAll(/data-dt-version="([^"]+)"/g)].map((m) => m[1]).find((v) => !/SECONDARY/i.test(v)), esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), icon = html.match(/class="app-icon-img"[^>]*?\ssrc="(https:\/\/image[^"]+)"/)?.[1] || html.match(new RegExp(`alt="${esc} icon"[^>]*?\\ssrc="(https://image[^"]+)"`))?.[1] || html.match(new RegExp(`src="(https://image[^"]+)"[^>]*alt="${esc} icon"`))?.[1] || (typeof ld?.image === "string" && /icon/.test(ld.image) ? ld.image : void 0);
      if (icon)
        icon = decodeHtml(icon).replace(/([?&])w=\d+/, "$1w=512");
      let ldShots = [].concat(ld?.screenshot || []).map((x) => typeof x === "string" ? x : x?.url).filter(Boolean), rawShots = ldShots.length ? ldShots : [...html.matchAll(/(https:\/\/image[^"\s]*?winudf\.com\/v2\/image1\/[^"\s]*?screen[^"\s]*)/g)].map((m) => m[1]), shots = [...new Map(rawShots.map((u) => {
        let url = decodeHtml(u).replace(/([?&])h=\d+/, "$1h=1280");
        return [url.replace(/\?.*$/, ""), url.includes("?") ? url : `${url}?fakeurl=1&type=.jpg`];
      })).values()].slice(0, 8), descHtml = html.match(/<div class="description-content"[^>]*>([\s\S]*?)<\/div>/)?.[1], description = ld?.description || (descHtml ? decodeHtml(descHtml.replace(/<br\s*\/?>/g, `
`).replace(/<[^>]+>/g, "")).trim() : void 0), versions = null;
      try {
        versions = sortVersionsDesc(Object.keys(await apkpureCodes(ctx, src.url)));
      } catch {}
      return {
        packageName: pkg,
        name,
        summary: description ? summarize(String(description)) : void 0,
        description,
        iconUrl: icon,
        screenshots: shots,
        website: page,
        latest: versions?.[0] || latest,
        versions: versions && versions.length ? versions : latest ? [latest] : null,
        autoUpdates: !0
      };
    }
    case "url":
    case "upload": {
      let r = await ctx.fetch(src.url, { method: "HEAD", headers: ua(ctx), redirect: "follow" }).catch(() => null), size = Number(r?.headers.get("content-length") || 0) || void 0;
      return {
        name: decodeURIComponent(new URL(r?.url || src.url).pathname.split("/").pop() || "app.apk").replace(/\.apk$/i, ""),
        versions: src.uploadedVersion ? [src.uploadedVersion] : null,
        latest: src.uploadedVersion,
        size,
        autoUpdates: !1
      };
    }
  }
}
function summarize(text) {
  let first = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0];
  if (first.length <= 80)
    return first;
  let cut = first.slice(0, 79);
  return cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : 79).replace(/[,;:]$/, "") + "…";
}
function fdroidPackage(url) {
  let m = url.match(/packages\/([^/?#]+)/);
  return m && PKG_RE.test(m[1]) ? m[1] : null;
}
function apkpurePage(url) {
  let parts = new URL(url).pathname.split("/").filter(Boolean).filter((p) => !/^[a-z]{2}(-[a-z]{2})?$/i.test(p) || PKG_RE.test(p)), pkg = parts.find((p) => PKG_RE.test(p));
  if (!pkg)
    throw Error("Could not find a package name in the APKPure URL");
  let idx = parts.indexOf(pkg), slug = parts[idx - 1] || "app";
  return { pkg, page: `https://apkpure.net/${slug}/${pkg}` };
}
function parseApkpureCodes(html, pkg) {
  let out = {}, esc = pkg.replace(/\./g, "\\."), re = new RegExp(`<a\\b[^>]*href="[^"]*/${esc}/download/([^"/?#]+)"[^>]*data-dt-version-code="(\\d+)"`, "g");
  for (let m of html.matchAll(re))
    out[decodeURIComponent(m[1])] = Number(m[2]);
  for (let tag of html.match(/<[^>]*data-dt-versioncode="\d+"[^>]*>/g) || []) {
    let v = tag.match(/data-dt-version="([^"]+)"/)?.[1], c = tag.match(/data-dt-versioncode="(\d+)"/)?.[1], p = tag.match(/data-dt-package(?:-?name)?="([^"]+)"/)?.[1];
    if (v && c && !/SECONDARY/i.test(v) && (!p || p === pkg))
      out[v] ??= Number(c);
  }
  return out;
}
async function apkpureCodes(ctx, url, version) {
  let { pkg, page } = apkpurePage(url), blocked = !1, get = async (u) => {
    for (let i = 0;; i++) {
      let r = await ctx.fetch(u, { headers: ua(ctx), redirect: "follow" });
      if (r.status !== 429 || i >= 2)
        return r;
      await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
    }
  }, direct = async () => {
    let r = await get(`${page}/versions`);
    if (!r.ok)
      throw blocked = !0, Error(`APKPure versions page responded ${r.status}`);
    let codes = parseApkpureCodes(await r.text(), pkg);
    if (version && !codes[version]) {
      let d = await get(`${page}/download/${encodeURIComponent(version)}`);
      if (d.ok) {
        let html = await d.text(), code = html.match(/d\.apkpure\.(?:net|com)\/b\/(?:APK|XAPK)\/[^"'\s]+?versionCode=(\d+)/)?.[1], shown = html.match(/data-dt-version="([^"]+)"/)?.[1];
        if (code && (!shown || shown === version))
          codes[version] = Number(code);
      } else if (d.status !== 404)
        blocked = !0;
    }
    return codes;
  };
  try {
    let codes = await direct();
    if (!version || codes[version] || !blocked || !ctx.resolver)
      return codes;
  } catch (e) {
    if (!blocked || !ctx.resolver)
      throw e;
  }
  let q = new URLSearchParams({ url: page, ...version ? { version } : {} }), r = await ctx.fetch(`${ctx.resolver.replace(/\/$/, "")}/api/apkpure/codes?${q}`), j = await r.json().catch(() => ({}));
  if (!r.ok)
    throw Error(`Couldn't read APKPure versions (${j.error || r.status})`);
  return j.codes || {};
}
async function getDownload(src, version, ctx) {
  switch (src.type) {
    case "github": {
      let { releases } = await githubReleases(ctx, src), rel = version && releases.find((r) => tagVersion(r.tag_name) === version || r.tag_name === version) || releases.find((r) => pickAsset(r, src.assetPattern));
      if (!rel)
        throw Error("No release with an APK found");
      let a = pickAsset(rel, src.assetPattern);
      if (!a)
        throw Error(`Release ${rel.tag_name} has no asset matching ${src.assetPattern || ".apk"}`);
      return { url: a.browser_download_url, version: tagVersion(rel.tag_name), fileName: a.name };
    }
    case "fdroid": {
      let pkg = fdroidPackage(src.url), api = await (await ctx.fetch(`https://f-droid.org/api/v1/packages/${pkg}`, { headers: ua(ctx) })).json(), list = api.packages || [], p = version && list.find((x) => x.versionName === version) || list.find((x) => x.versionCode === api.suggestedVersionCode) || list[0];
      if (!p)
        throw Error("F-Droid has no builds for this package");
      return {
        url: `https://f-droid.org/repo/${pkg}_${p.versionCode}.apk`,
        version: p.versionName,
        versionCode: p.versionCode,
        fileName: `${pkg}_${p.versionCode}.apk`
      };
    }
    case "apkpure": {
      let { pkg } = apkpurePage(src.url), codes = await apkpureCodes(ctx, src.url, version), want = version || sortVersionsDesc(Object.keys(codes))[0];
      if (!want || !codes[want])
        throw Error(`APKPure has no download for ${pkg} ${version ?? "(no versions listed)"}`);
      return { url: `https://d.apkpure.net/b/APK/${pkg}?versionCode=${codes[want]}`, version: want, versionCode: codes[want], fileName: `${pkg}.apk` };
    }
    case "url":
    case "upload":
      return { url: src.url, version: src.uploadedVersion, fileName: "source.apk" };
  }
}

// engine/patches.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";

// shared/patchlist.ts
function fromPatchesList(j) {
  return (j.patches || []).map((p) => ({
    name: p.name,
    description: p.description,
    default: p.default !== !1,
    packages: p.compatiblePackages ? p.compatiblePackages.map((c) => ({
      packageName: c.packageName,
      name: c.name || void 0,
      signatures: Array.isArray(c.signatures) && c.signatures.length ? c.signatures.map((x) => x.toLowerCase().replace(/[^0-9a-f]/g, "")) : void 0,
      versions: (() => {
        let v = c.targets ? c.targets.filter((t) => !t.isExperimental).map((t) => t.version).filter(Boolean) : c.versions || [];
        return v.length ? v : null;
      })()
    })) : null,
    options: (p.options || []).map((o) => ({
      key: o.key,
      title: o.title,
      description: o.description?.trim(),
      required: o.required,
      type: o.type,
      default: o.default,
      values: o.values
    }))
  }));
}

// engine/util.ts
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
var env = process.env, REPO = env.GITHUB_REPOSITORY || "", RUN_ID = Number(env.GITHUB_RUN_ID || 0), WORK = env.RELEVANCE_WORK || "work";
mkdirSync(WORK, { recursive: !0 });
var relayUrl = "", currentStep = "engine", queue = [], flushing = null, timer = null, oidc = null, relayBroken = !1;
function setRelay(url) {
  relayUrl = url ? url.replace(/\/$/, "") : "";
}
function setStep(step) {
  currentStep = step;
}
async function oidcToken() {
  if (oidc && oidc.exp > Date.now() + 60000)
    return oidc.token;
  let { ACTIONS_ID_TOKEN_REQUEST_URL: u, ACTIONS_ID_TOKEN_REQUEST_TOKEN: t } = env;
  if (!u || !t)
    return null;
  try {
    let aud = relayUrl ? new URL(relayUrl).host : "relevance", j = await (await fetch(`${u}&audience=${encodeURIComponent(aud)}`, { headers: { Authorization: `bearer ${t}` } })).json();
    return oidc = { token: j.value, exp: Date.now() + 240000 }, j.value;
  } catch {
    return null;
  }
}
async function relayPost(path, body) {
  if (!relayUrl)
    return null;
  let tok = await oidcToken();
  if (!tok)
    return null;
  return fetch(`${relayUrl}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).catch(() => null);
}
async function doFlush() {
  if (!queue.length || !relayUrl || relayBroken || !RUN_ID) {
    queue = [];
    return;
  }
  let events = queue;
  queue = [];
  let r = await relayPost("/api/relay/publish", { run: RUN_ID, repo: REPO, events });
  if (r && r.status === 401)
    relayBroken = !0;
}
function flush() {
  if (timer)
    clearTimeout(timer), timer = null;
  return flushing = (flushing || Promise.resolve()).then(doFlush, doFlush), flushing;
}
function enqueue(e) {
  if (queue.push({ step: currentStep, t: Date.now(), ...e }), queue.length > 200)
    flush();
  else if (!timer)
    timer = setTimeout(() => void flush(), 350);
}
function log(...parts) {
  let line = parts.map((p) => typeof p === "string" ? p : JSON.stringify(p)).join(" ");
  for (let l of line.split(`
`))
    process.stdout.write(l + `
`), enqueue({ line: l });
}
var ok = (s) => log(`✓ ${s}`), info = (s) => log(`> ${s}`), warn = (s) => {
  process.stdout.write(`::warning::${s}
`), enqueue({ line: `! ${s}` });
};
function stepStatus(status, extra) {
  enqueue({ status: extra ? `${status}:${extra}` : status });
}
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    if (!opts.quiet)
      info(`${cmd} ${args.map((a) => /\s/.test(a) ? JSON.stringify(a) : a).join(" ")}`.slice(0, 600));
    let p = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env } }), out = "", partial = "", onData = (d) => {
      let lines = (partial + d.toString()).split(/\r?\n/);
      partial = lines.pop() || "";
      for (let l of lines) {
        if (out += l + `
`, out.length > 2000000)
          out = out.slice(-1e6);
        if (!opts.quiet)
          log(l);
      }
    };
    p.stdout.on("data", onData), p.stderr.on("data", onData), p.on("error", reject), p.on("close", (code) => {
      if (partial) {
        if (out += partial, !opts.quiet)
          log(partial);
      }
      if (code !== 0 && opts.quiet)
        for (let l of out.split(`
`).slice(-30))
          log(l);
      code === 0 ? resolve(out) : reject(Object.assign(Error(`${cmd} exited with code ${code}`), { output: out }));
    });
  });
}
function readJson(p, fallback) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(p, v) {
  mkdirSync(dirname(p), { recursive: !0 }), writeFileSync(p, JSON.stringify(v, null, 2) + `
`);
}
async function download(url, dest, headers = {}) {
  mkdirSync(dirname(dest), { recursive: !0 });
  let started = Date.now(), r = await fetch(url, { headers: { "User-Agent": "Relevance-Engine", ...headers }, redirect: "follow" });
  if (!r.ok || !r.body)
    throw Error(`Download failed (${r.status}) for ${url}`);
  let total = Number(r.headers.get("content-length") || 0), got = 0, lastLog = 0, reader = Readable.fromWeb(r.body);
  return reader.on("data", (c) => {
    if (got += c.length, Date.now() - lastLog > 1500)
      lastLog = Date.now(), log(`… ${(got / 1048576).toFixed(1)} MB${total ? ` / ${(total / 1048576).toFixed(1)} MB` : ""}`);
  }), await pipeline(reader, createWriteStream(dest)), ok(`Downloaded ${(got / 1048576).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(1)} s`), { size: got, finalUrl: r.url, contentType: r.headers.get("content-type") || "" };
}
async function ghApi(path, init = {}) {
  let url = path.startsWith("http") ? path : `https://api.github.com${path}`, r = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Relevance-Engine",
      ...init.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {},
      ...init.headers
    }
  });
  if (!r.ok) {
    let t = await r.text().catch(() => ""), e = Error(`GitHub ${init.method || "GET"} ${path} → ${r.status} ${t.slice(0, 300)}`);
    throw e.status = r.status, e;
  }
  if (r.status === 204)
    return;
  return init.raw ? r : r.json();
}
async function getFile(path) {
  try {
    let j = await ghApi(`/repos/${REPO}/contents/${path}?ref=${env.GITHUB_REF_NAME || "main"}`);
    return { text: Buffer.from(j.content, "base64").toString("utf8"), sha: j.sha };
  } catch (e) {
    if (e.status === 404)
      return null;
    throw e;
  }
}
async function putFile(path, mutate, message) {
  for (let i = 0;i < 6; i++) {
    let cur = await getFile(path), next = mutate(cur?.text ?? null);
    if (cur && next === cur.text)
      return;
    try {
      await ghApi(`/repos/${REPO}/contents/${path}`, {
        method: "PUT",
        body: JSON.stringify({
          message,
          content: Buffer.from(next).toString("base64"),
          sha: cur?.sha,
          branch: env.GITHUB_REF_NAME || "main",
          committer: { name: "Relevance", email: "41898282+github-actions[bot]@users.noreply.github.com" }
        })
      });
      return;
    } catch (e) {
      if (e.status !== 409 && e.status !== 422)
        throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1) + Math.random() * 500));
    }
  }
  throw Error(`Could not update ${path} after several attempts`);
}
function loadConfig() {
  if (!existsSync("relevance.json"))
    throw Error("relevance.json not found in repository");
  return JSON.parse(readFileSync("relevance.json", "utf8"));
}
var statePath = (appId) => `.relevance/state/${appId}.json`;
function emptyState(appId) {
  return { appId, status: "never", releases: [], history: [] };
}
function loadState(appId) {
  return readJson(statePath(appId), emptyState(appId));
}
async function updateState(appId, fn, message) {
  let result = emptyState(appId);
  return await putFile(statePath(appId), (old) => {
    let s = old ? JSON.parse(old) : emptyState(appId);
    return fn(s), s.history = (s.history || []).slice(0, 60), result = s, JSON.stringify(s, null, 2) + `
`;
  }, message), writeJson(statePath(appId), result), result;
}
function setOutput(k, v) {
  if (env.GITHUB_OUTPUT)
    writeFileSync(env.GITHUB_OUTPUT, `${k}=${v}
`, { flag: "a" });
}
async function latestReleaseAsset(ownerRepo, re) {
  let all = await ghApi(`/repos/${ownerRepo}/releases?per_page=15`), rels = [...all.filter((r) => !r.prerelease), ...all.filter((r) => r.prerelease)];
  for (let rel of rels) {
    if (rel.draft)
      continue;
    let a = rel.assets.find((x) => re.test(x.name));
    if (a)
      return { url: a.browser_download_url, name: a.name, tag: rel.tag_name };
  }
  throw Error(`No release asset matching ${re} in ${ownerRepo}`);
}
function shortErr(e) {
  return (e instanceof Error ? e.message : String(e)).split(`
`)[0].slice(0, 300);
}

// engine/patches.ts
var INDEX_BASE = "https://raw.githubusercontent.com/oxcl/relevance/index", BUILTIN_SOURCES = [
  { id: "revanced", tool: "revanced", name: "ReVanced", url: "https://gitlab.com/ReVanced/revanced-patches", builtin: !0 },
  { id: "morphe", tool: "morphe", name: "Morphe", url: "https://github.com/MorpheApp/morphe-patches", builtin: !0 },
  { id: "lsposed", tool: "lspatch", name: "LSPosed module repository", url: "https://modules.lsposed.org", builtin: !0 }
], BUNDLE_EXT = {
  revanced: /\.(rvp|jar)$/i,
  morphe: /\.(mpp|rvp|jar)$/i
};
async function resolveBundle(src) {
  if (src.id === "revanced" || /api\.revanced\.app/.test(src.url)) {
    let j = await (await fetch("https://api.revanced.app/v5/patches")).json();
    return { url: j.download_url, version: j.version };
  }
  let ext = BUNDLE_EXT[src.tool] || /\.(rvp|mpp|jar)$/i;
  if (ext.test(new URL(src.url).pathname))
    return { url: src.url, version: new URL(src.url).pathname.split("/").pop() };
  let gh = src.url.match(/github\.com\/([^/]+)\/([^/#?]+)/);
  if (gh) {
    let a = await latestReleaseAsset(`${gh[1]}/${gh[2].replace(/\.git$/, "")}`, ext);
    return { url: a.url, version: a.tag };
  }
  let gl = src.url.match(/gitlab\.com\/(.+?)\/?$/);
  if (gl) {
    let proj = encodeURIComponent(gl[1].replace(/\.git$/, "")), rels = await (await fetch(`https://gitlab.com/api/v4/projects/${proj}/releases?per_page=10`)).json();
    for (let r of rels) {
      let link = (r.assets?.links || []).find((l) => ext.test(l.name) || ext.test(l.url));
      if (link)
        return { url: link.direct_asset_url || link.url, version: r.tag_name };
    }
    throw Error(`No patch bundle found in GitLab releases of ${gl[1]}`);
  }
  throw Error(`Unsupported patch source URL: ${src.url}`);
}
var bundleCache = /* @__PURE__ */ new Map;
async function fetchBundle(src) {
  let b = await resolveBundle(src), cached = bundleCache.get(b.url);
  if (cached)
    return { file: cached, version: b.version };
  let ext = src.tool === "morphe" ? ".mpp" : ".rvp", file = `${WORK}/bundles/${(src.id || "custom").replace(/\W/g, "_")}-${bundleCache.size}${ext}`;
  return info(`Downloading ${src.tool} patches ${b.version}`), await download(b.url, file), bundleCache.set(b.url, file), { file, version: b.version };
}
var cliCache = /* @__PURE__ */ new Map;
async function fetchCli(tool) {
  if (cliCache.has(tool))
    return cliCache.get(tool);
  let map = {
    revanced: ["ReVanced/revanced-cli", /-all\.jar$/],
    morphe: ["MorpheApp/morphe-cli", /-all\.jar$/],
    lspatch: ["JingMatrix/LSPatch", /^lspatch-.*-release\.jar$/],
    apktool: ["iBotPeaches/Apktool", /^apktool_.*\.jar$/],
    apkeditor: ["REAndroid/APKEditor", /^APKEditor.*\.jar$/]
  }, [repo, re] = map[tool], a = await latestReleaseAsset(repo, re), file = `${WORK}/tools/${a.name}`;
  if (!existsSync2(file))
    info(`Downloading ${repo} ${a.tag}`), await download(a.url, file);
  return cliCache.set(tool, file), file;
}
function parseListPatches(text) {
  let lines = text.replace(/\r/g, "").split(`
`).map((l) => l.replace(/^(INFO|WARNING|SEVERE):\s?/, "")), out = [], cur = null, opt = null, compat = null, inValues = !1;
  for (let raw of lines) {
    let depth = raw.match(/^\t*/)[0].length, l = raw.trim();
    if (depth === 0 && /^Index: \d+/.test(l)) {
      cur = { name: "", packages: null, options: [], default: !0 }, out.push(cur), opt = null, compat = null;
      continue;
    }
    if (depth === 0 && l.startsWith("Name: ") && (!cur || cur.name))
      cur = { name: "", packages: null, options: [], default: !0 }, out.push(cur), opt = null, compat = null;
    if (!cur)
      continue;
    if (depth === 0) {
      if (l.startsWith("Name: "))
        cur.name = l.slice(6);
      else if (l.startsWith("Description: "))
        cur.description = l.slice(13);
      else if (l.startsWith("Enabled: "))
        cur.default = l.slice(9) === "true";
      else if (l === "Options:")
        cur._section = "options";
      else if (l === "Compatible packages:")
        cur._section = "packages", cur.packages = [];
      else if (l && cur._section === void 0 && cur.description)
        cur.description += `
` + l;
      continue;
    }
    if (cur._section === "options") {
      if (depth === 1 && l.startsWith("Name: "))
        opt = { key: l.slice(6), title: l.slice(6) }, cur.options.push(opt), inValues = !1;
      else if (opt && depth === 1) {
        if (l.startsWith("Description: "))
          opt.description = l.slice(13);
        else if (l.startsWith("Required: "))
          opt.required = l.slice(10) === "true";
        else if (l.startsWith("Default: "))
          opt.default = l.slice(9);
        else if (l.startsWith("Type: "))
          opt.type = l.slice(6), inValues = !1;
        else if (l === "Possible values:")
          inValues = !0, opt.values = {};
        else if (l && !inValues && opt.description)
          opt.description += `
` + l;
      } else if (opt && depth >= 2 && inValues) {
        let m = l.match(/^(.*) \((.*)\)$/);
        if (m)
          opt.values[m[2]] = m[1];
      }
    } else if (cur._section === "packages") {
      if (depth === 1 && l.startsWith("Package name: "))
        compat = { packageName: l.slice(14), versions: null }, cur.packages.push(compat);
      else if (depth >= 2 && compat && l && l !== "Compatible versions:")
        (compat.versions ||= []).push(l);
    }
  }
  for (let p of out)
    delete p._section;
  return out.filter((p) => p.name);
}
async function tryPatchesList(url) {
  let gh = url.match(/github\.com\/([^/]+)\/([^/#?]+)/);
  if (!gh)
    return null;
  try {
    let r = await fetch(`https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/main/patches-list.json`);
    if (!r.ok)
      return null;
    let j = await r.json();
    return { patches: fromPatchesList(j), version: j.version || "unknown" };
  } catch {
    return null;
  }
}
async function indexSource(src) {
  let base = { tool: src.tool, sourceId: src.id, name: src.name, fetchedAt: (/* @__PURE__ */ new Date()).toISOString() };
  if (src.tool === "lspatch")
    return { ...base, version: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10), patches: await indexLsposed() };
  let list = await tryPatchesList(src.url);
  if (list) {
    let bundleUrl;
    try {
      bundleUrl = (await resolveBundle(src)).url;
    } catch {}
    return { ...base, version: list.version, bundleUrl, patches: list.patches };
  }
  let { file, version } = await fetchBundle(src), cli = await fetchCli(src.tool), args = src.tool === "revanced" ? ["-jar", cli, "list-patches", "--index", "--packages", "--versions", "--options", "--universal-patches", "-p", file, "-b"] : ["-jar", cli, "list-patches", "-i", "-d", "-p", "-v", "-o", "-u", "--patches", file], out = await run("java", args, { quiet: !1 }), patches = parseListPatches(out);
  return log(`Indexed ${patches.length} patches from ${src.name} ${version}`), { ...base, version, bundleUrl: (await resolveBundle(src)).url, patches };
}
async function indexLsposed() {
  let mods = null;
  for (let url of ["https://modules.lsposed.org/modules.json", "https://backup.modules.lsposed.org/modules.json"])
    try {
      let r = await fetch(url);
      if (r.ok) {
        mods = await r.json();
        break;
      }
      log(`! ${url} responded ${r.status}`);
    } catch {}
  if (mods)
    return mods.filter((m) => !m.hide && m.latestRelease).map((m) => ({
      name: m.description || m.name,
      description: m.summary || null,
      default: !1,
      packages: Array.isArray(m.scope) && m.scope.length ? m.scope.map((s) => ({ packageName: s, versions: null })) : [],
      module: { repo: `Xposed-Modules-Repo/${m.name}`, summary: m.summary || void 0 }
    }));
  log("Falling back to the Xposed-Modules-Repo GitHub organization");
  let out = [];
  for (let page = 1;page <= 25; page++) {
    let repos = await ghApi(`/orgs/Xposed-Modules-Repo/repos?per_page=100&page=${page}`);
    for (let r of repos) {
      if (r.archived || r.name === "submission" || !r.description)
        continue;
      let pkgs = [...new Set(((r.description || "") + " " + (r.homepage || "")).match(/\b[a-z][\w]*(\.[a-z][\w]*){2,}\b/gi) || [])];
      out.push({ name: r.description, description: null, default: !1, packages: pkgs.map((p) => ({ packageName: p, versions: null })), module: { repo: r.full_name } });
    }
    if (repos.length < 100)
      break;
  }
  return out;
}
async function loadIndex(src) {
  let local = `.relevance/index/${src.id}.json`;
  if (!src.builtin && existsSync2(local))
    return JSON.parse(readFileSync2(local, "utf8"));
  try {
    let r = await fetch(`${INDEX_BASE}/${src.id}.json`);
    if (r.ok)
      return await r.json();
  } catch {}
  return null;
}
async function moduleApk(repoOrUrl, dest) {
  if (/\.apk(\?|$)/i.test(repoOrUrl))
    return await download(repoOrUrl, dest), dest;
  let m = repoOrUrl.match(/(?:github\.com\/)?([\w.-]+\/[\w.-]+)\/?$/);
  if (!m)
    throw Error(`Unsupported module source ${repoOrUrl}`);
  let a = await latestReleaseAsset(m[1], /\.apk$/i);
  return info(`Module ${m[1]} ${a.tag}: ${a.name}`), await download(a.url, dest), dest;
}

// engine/notify.ts
async function notify(cfg, app, st) {
  let n = cfg.settings?.notifications || { email: !0, issue: !0, inApp: !0, fdroid: !0 }, att = st.attention;
  if (!att)
    return;
  let runUrl = `https://github.com/${REPO}/actions/runs/${RUN_ID}`, appUrl = `${cfg.settings.relevanceUrl}/apps/${app.id}`, what = {
    "build-failed": "update build failed",
    "selection-changed": "your patch selection needs a review",
    "no-compatible-version": "no compatible version available",
    "signature-changed": "the original app's signature doesn't match"
  }, title = `${app.customize?.name || app.name}: ${what[att.kind] || "needs attention"}`, body = [
    att.message,
    "",
    ...(att.details || []).map((d) => `> ${d}`),
    "",
    `- Open in Relevance: ${appUrl}`,
    `- Build log: ${runUrl}`,
    "",
    "The last good build stays published until you act."
  ].join(`
`);
  if (n.issue)
    try {
      let same = (await ghApi(`/repos/${REPO}/issues?state=open&labels=relevance&per_page=50`)).find((i) => i.title === title);
      if (same)
        await ghApi(`/repos/${REPO}/issues/${same.number}/comments`, { method: "POST", body: JSON.stringify({ body }) });
      else
        await ghApi(`/repos/${REPO}/issues`, { method: "POST", body: JSON.stringify({ title, body, labels: ["relevance"] }) });
      log("✓ Opened a GitHub issue");
    } catch (e) {
      warn(`Could not open an issue: ${e.message}`);
    }
  if (n.email && cfg.settings.emailToken) {
    let r = await relayPost("/api/notify/email", {
      repo: REPO,
      token: cfg.settings.emailToken,
      subject: `Relevance · ${title}`,
      text: `${body}
`,
      appUrl,
      runUrl,
      appName: app.customize?.name || app.name,
      message: att.message
    });
    if (r?.ok)
      log("✓ Sent an email notification");
    else
      warn(`Email notification not sent (${r?.status ?? "relay unavailable"})`);
  }
}
async function resolveIssues(app) {
  try {
    let existing = await ghApi(`/repos/${REPO}/issues?state=open&labels=relevance&per_page=50`), name = app.customize?.name || app.name;
    for (let i of existing.filter((i) => i.title.startsWith(`${name}:`)))
      await ghApi(`/repos/${REPO}/issues/${i.number}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: `Resolved — a new build was published successfully (run ${RUN_ID}).` })
      }), await ghApi(`/repos/${REPO}/issues/${i.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed" }) });
  } catch {}
}

// engine/axml.ts
var ATTR = {
  label: 16842753,
  name: 16842755,
  permission: 16842758,
  taskAffinity: 16842770,
  authorities: 16842776,
  manageSpaceActivity: 16842756,
  targetActivity: 16843266,
  backupAgent: 16843391,
  readPermission: 16842759,
  writePermission: 16842760
};
function decodePool(b, at) {
  let headerSize = b.readUInt16LE(at + 2), size = b.readUInt32LE(at + 4), count = b.readUInt32LE(at + 8), styleCount = b.readUInt32LE(at + 12), flags = b.readUInt32LE(at + 16), stringsStart = b.readUInt32LE(at + 20), stylesStart = b.readUInt32LE(at + 24), utf8 = (flags & 256) !== 0, strings = [];
  for (let i = 0;i < count; i++) {
    let p = at + stringsStart + b.readUInt32LE(at + headerSize + i * 4);
    if (utf8) {
      let n = b[p++];
      if (n & 128)
        n = (n & 127) << 8 | b[p++];
      let len = b[p++];
      if (len & 128)
        len = (len & 127) << 8 | b[p++];
      strings.push(b.toString("utf8", p, p + len));
    } else {
      let len = b.readUInt16LE(p);
      if (p += 2, len & 32768)
        len = (len & 32767) << 16 | b.readUInt16LE(p), p += 2;
      strings.push(b.toString("utf16le", p, p + len * 2));
    }
  }
  let styleOffsets = styleCount ? b.subarray(at + headerSize + count * 4, at + headerSize + count * 4 + styleCount * 4) : Buffer.alloc(0), styles = styleCount ? b.subarray(at + stylesStart, at + size) : Buffer.alloc(0);
  return { size, utf8, strings, flags, styleCount, styleOffsets: Buffer.from(styleOffsets), styles: Buffer.from(styles) };
}
function encodePool(p, strings) {
  let parts = [], offsets = [], pos = 0;
  for (let s of strings) {
    offsets.push(pos);
    let buf;
    if (p.utf8) {
      let bytes = Buffer.from(s, "utf8"), len = (n) => n > 127 ? Buffer.from([128 | n >> 8, n & 255]) : Buffer.from([n]);
      buf = Buffer.concat([len(s.length), len(bytes.length), bytes, Buffer.from([0])]);
    } else {
      let chars = Buffer.from(s, "utf16le"), n = s.length, head = n > 32767 ? Buffer.from([n >> 16 & 32767 | 32768, n & 65535].flatMap((v) => [v & 255, v >> 8])) : Buffer.from([n & 255, n >> 8]);
      buf = Buffer.concat([head, chars, Buffer.from([0, 0])]);
    }
    parts.push(buf), pos += buf.length;
  }
  let data = Buffer.concat(parts);
  if (data.length % 4)
    data = Buffer.concat([data, Buffer.alloc(4 - data.length % 4)]);
  let headerSize = 28, stringsStart = headerSize + strings.length * 4 + p.styleCount * 4, stylesStart = p.styleCount ? stringsStart + data.length : 0, size = stringsStart + data.length + p.styles.length, h = Buffer.alloc(headerSize);
  h.writeUInt16LE(1, 0), h.writeUInt16LE(headerSize, 2), h.writeUInt32LE(size, 4), h.writeUInt32LE(strings.length, 8), h.writeUInt32LE(p.styleCount, 12), h.writeUInt32LE(p.flags & -2, 16), h.writeUInt32LE(stringsStart, 20), h.writeUInt32LE(stylesStart, 24);
  let offs = Buffer.alloc(strings.length * 4);
  return offsets.forEach((o, i) => offs.writeUInt32LE(o, i * 4)), Buffer.concat([h, offs, p.styleOffsets, data, p.styles]);
}
function parse(b) {
  if (b.readUInt16LE(0) !== 3)
    throw Error("Not a binary XML file");
  let poolAt = b.readUInt16LE(2);
  if (b.readUInt16LE(poolAt) !== 1)
    throw Error("Binary XML without string pool");
  let pool = decodePool(b, poolAt), resMap = [], root = { name: "#root", attrs: [], children: [] }, cur = root, p = poolAt + pool.size;
  while (p < b.length) {
    let type = b.readUInt16LE(p), size = b.readUInt32LE(p + 4);
    if (type === 384) {
      let n = (size - 8) / 4;
      resMap = Array.from({ length: n }, (_, i) => b.readUInt32LE(p + 8 + i * 4));
    } else if (type === 258) {
      let ext = p + b.readUInt16LE(p + 2), name = pool.strings[b.readUInt32LE(ext + 4)], attrStart = b.readUInt16LE(ext + 8), attrSize = b.readUInt16LE(ext + 10), count = b.readUInt16LE(ext + 12), el = { name, attrs: [], children: [], parent: cur };
      for (let i = 0;i < count; i++) {
        let off = ext + attrStart + i * attrSize, nameIdx = b.readUInt32LE(off + 4);
        el.attrs.push({
          off,
          nameIdx,
          resId: resMap[nameIdx] ?? 0,
          name: pool.strings[nameIdx] ?? "",
          raw: b.readInt32LE(off + 8),
          type: b[off + 15],
          data: b.readUInt32LE(off + 16)
        });
      }
      cur.children.push(el), cur = el;
    } else if (type === 259)
      cur = cur.parent || root;
    if (size <= 0)
      break;
    p += size;
  }
  return { poolAt, pool, root };
}
var walk = (e, f) => {
  f(e);
  for (let c of e.children)
    walk(c, f);
};
function editManifest(input, edit) {
  let b = Buffer.from(input), { poolAt, pool, root } = parse(b), strings = [...pool.strings], changes = [], intern = (s) => (strings.push(s), strings.length - 1), strOf = (a) => a.type === 3 ? strings[a.data] : a.raw >= 0 ? strings[a.raw] : void 0, setStr = (a, v) => {
    let idx = intern(v);
    b.writeInt32LE(idx, a.off + 8), b.writeUInt16LE(8, a.off + 12), b[a.off + 14] = 0, b[a.off + 15] = 3, b.writeUInt32LE(idx, a.off + 16), a.raw = idx, a.type = 3, a.data = idx;
  }, attr = (e, id, plain) => e.attrs.find((a) => a.resId ? a.resId === id : plain !== void 0 && a.name === plain && !a.resId), manifest;
  if (walk(root, (e) => manifest ||= e.name === "manifest" ? e : void 0), !manifest)
    throw Error("No <manifest> element");
  let pkgAttr = manifest.attrs.find((a) => a.name === "package" && !a.resId), oldPkg = pkgAttr && strOf(pkgAttr);
  if (!pkgAttr || !oldPkg)
    throw Error("Manifest has no package attribute");
  let app = manifest.children.find((c) => c.name === "application");
  if (edit.label) {
    let targets = [];
    if (app)
      targets.push(app);
    walk(manifest, (e) => {
      if (e.name !== "activity" && e.name !== "activity-alias")
        return;
      let launcher = !1;
      if (walk(e, (c) => {
        if (c.name === "category" && strOf(attr(c, ATTR.name, "name") || {}) === "android.intent.category.LAUNCHER")
          launcher = !0;
      }), launcher)
        targets.push(e);
    });
    let n = 0;
    for (let t of targets) {
      let a = attr(t, ATTR.label, "label");
      if (a)
        setStr(a, edit.label), n++;
      else if (t === app)
        throw Error("The <application> element has no label to replace");
    }
    changes.push(`label → "${edit.label}" (${n} place${n === 1 ? "" : "s"})`);
  }
  let newPkg = edit.packageName;
  if (newPkg && newPkg !== oldPkg) {
    let absolute = (v) => v.startsWith(".") ? oldPkg + v : v.includes(".") ? v : `${oldPkg}.${v}`, components = /* @__PURE__ */ new Set(["application", "activity", "activity-alias", "service", "receiver", "provider", "instrumentation"]), classes = 0;
    if (walk(manifest, (e) => {
      if (!components.has(e.name))
        return;
      let ids = e.name === "activity-alias" ? [ATTR.targetActivity] : [ATTR.name, ATTR.backupAgent, ATTR.manageSpaceActivity];
      for (let id of ids) {
        let a = attr(e, id), v = a && strOf(a);
        if (a && v && absolute(v) !== v)
          setStr(a, absolute(v)), classes++;
      }
    }), classes)
      changes.push(`${classes} relative class name${classes === 1 ? "" : "s"} made absolute`);
    setStr(pkgAttr, newPkg), changes.push(`package ${oldPkg} → ${newPkg}`);
    let move = (v) => v.startsWith(oldPkg) ? newPkg + v.slice(oldPkg.length) : `${newPkg}.${v}`, auth = 0;
    if (walk(manifest, (e) => {
      if (e.name !== "provider")
        return;
      let a = attr(e, ATTR.authorities), v = a && strOf(a);
      if (a && v)
        setStr(a, v.split(";").map(move).join(";")), auth++;
    }), auth)
      changes.push(`${auth} provider authorit${auth === 1 ? "y" : "ies"} moved`);
    let declared = /* @__PURE__ */ new Set;
    walk(manifest, (e) => {
      if (e.name !== "permission")
        return;
      let v = strOf(attr(e, ATTR.name) || {});
      if (v)
        declared.add(v);
    });
    let perms = 0;
    if (declared.size)
      walk(manifest, (e) => {
        for (let a of e.attrs) {
          if (![ATTR.name, ATTR.permission, ATTR.readPermission, ATTR.writePermission].includes(a.resId))
            continue;
          let v = strOf(a);
          if (v && declared.has(v))
            setStr(a, move(v)), perms++;
        }
      });
    if (declared.size)
      changes.push(`${declared.size} custom permission${declared.size === 1 ? "" : "s"} renamed (${perms} references)`);
    walk(manifest, (e) => {
      let a = attr(e, ATTR.taskAffinity), v = a && strOf(a);
      if (a && v && v.startsWith(oldPkg))
        setStr(a, newPkg + v.slice(oldPkg.length));
    });
  }
  let newPool = encodePool(pool, strings), out = Buffer.concat([b.subarray(0, poolAt), newPool, b.subarray(poolAt + pool.size)]);
  return out.writeUInt32LE(out.length, 4), { bytes: out, oldPackage: oldPkg, changes };
}

// engine/apkeep.ts
import { chmodSync, createReadStream, existsSync as existsSync3, mkdirSync as mkdirSync2, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
var VERSION = "1.1.0", SHA256 = "badd7ad9fa7d2f32abe01eaf33b7ff086361a95bbc000a33bf44b630d4bf2140", bin = null;
async function sha256(file) {
  let h = createHash("sha256");
  for await (let c of createReadStream(file))
    h.update(c);
  return h.digest("hex");
}
async function apkeepBin() {
  if (bin)
    return bin;
  let file = join(WORK, "tools", `apkeep-${VERSION}`);
  if (!existsSync3(file))
    info(`Downloading apkeep ${VERSION}`), await download(`https://github.com/EFForg/apkeep/releases/download/${VERSION}/apkeep-x86_64-unknown-linux-gnu`, file);
  let got = await sha256(file);
  if (got !== SHA256)
    throw Error(`apkeep checksum mismatch (${got}); refusing to run it`);
  return chmodSync(file, 493), bin = file, file;
}
var listCache = /* @__PURE__ */ new Map;
async function apkeepVersions(pkg) {
  if (listCache.has(pkg))
    return listCache.get(pkg);
  let line = (await run(await apkeepBin(), ["-l", "-a", pkg, "-d", "apk-pure", "-o", "output_format=json"], { quiet: !0 })).split(`
`).find((l) => l.trim().startsWith("{")), app = (line ? JSON.parse(line) : null)?.apps?.[pkg];
  if (!app || app.error)
    throw Error(`APKPure has no listing for ${pkg}${app?.error ? ` (${app.error})` : ""}`);
  let versions = sortVersionsDesc((app.available_versions || []).map((v) => String(v.version)));
  if (!versions.length)
    throw Error(`APKPure lists no versions for ${pkg}`);
  return listCache.set(pkg, versions), versions;
}
async function apkeepDownload(pkg, version) {
  let dir = join(WORK, "apkeep");
  mkdirSync2(dir, { recursive: !0 }), info(`Downloading ${pkg} ${version} from APKPure with apkeep`), await run(await apkeepBin(), ["-a", `${pkg}@${version}`, "-d", "apk-pure", "-o", "acknowledge_dangers=true", dir]);
  let file = readdirSync(dir).find((f) => f.startsWith(`${pkg}@${version}.`) && /\.(x?apk)$/i.test(f));
  if (!file)
    throw Error(`apkeep did not produce ${pkg} ${version}`);
  return ok(`Got ${file}`), join(dir, file);
}

// engine/build.ts
function srcCtx() {
  let resolver = env.RELEVANCE_URL;
  try {
    resolver ||= loadConfig().settings.relevanceUrl;
  } catch {}
  return { fetch: (i, o) => fetch(i, o), githubToken: env.GITHUB_TOKEN, resolver };
}
async function sourceVersions(app) {
  if (app.source.type === "apkpure") {
    let versions = await apkeepVersions(apkpurePage(app.source.url).pkg);
    return { versions, latest: versions[0] };
  }
  let si = await resolveSource(app.source, srcCtx());
  return { versions: si.versions, latest: si.latest || si.versions?.[0] };
}
async function sourceDownload(app, version) {
  if (app.source.type === "apkpure") {
    let pkg = apkpurePage(app.source.url).pkg, versions = await apkeepVersions(pkg), want = version || versions[0];
    if (!versions.includes(want))
      throw Object.assign(Error(`APKPure doesn't offer ${pkg} ${want}, which your patches need (newest there: ${versions[0]})`), {
        attention: "no-compatible-version"
      });
    return { url: `apkeep:${pkg}@${want}`, fileName: `${pkg}.apk`, version: want };
  }
  let dl = await getDownload(app.source, version, srcCtx());
  if (version && dl.version !== version && app.source.type === "fdroid")
    throw Object.assign(Error(`F-Droid doesn't offer version ${version}, which your patches need`), { attention: "no-compatible-version" });
  return dl;
}
function expectedSignatures(index, pkg) {
  let sigs = /* @__PURE__ */ new Set;
  for (let p of index?.patches || [])
    for (let c of p.packages || [])
      if (c.packageName === pkg)
        for (let s of c.signatures || [])
          sigs.add(s);
  return sigs.size ? [...sigs] : void 0;
}
async function apkCerts(file) {
  let out;
  try {
    out = await run(join2(buildTools(), "apksigner"), ["verify", "--print-certs", file], { quiet: !0 });
  } catch {
    throw Error(`${file.split("/").pop()} has a missing or invalid signature — the download may be corrupt or modified`);
  }
  let certs = [...new Set([...out.matchAll(/certificate SHA-256 digest: ([0-9a-f]{64})/gi)].map((m) => m[1].toLowerCase()))];
  if (!certs.length)
    throw Error(`Couldn't read the signing certificate of ${file.split("/").pop()}`);
  return certs;
}
var short = (c) => c.slice(0, 16).replace(/(.{4})/g, "$1 ").trim() + "…";
async function checkOriginal(app, p, certs) {
  let st = loadState(app.id);
  info(`Original signature: ${certs.map(short).join(", ")}`);
  let overlap = (a, b) => a.some((x) => b.includes(x));
  if (p.expectedSignatures?.length) {
    if (!overlap(certs, p.expectedSignatures))
      throw Object.assign(Error(`The downloaded ${app.name} is not signed by its developer: its certificate (${short(certs[0])}) doesn't match the one ${p.expectedFrom} publishes for this app. The file may have been modified by the source.`), { attention: "signature-changed" });
    ok(`Signature matches the one published by ${p.expectedFrom}`);
  }
  let pinned = st.sourceCert?.sha256;
  if (pinned?.length) {
    if (!overlap(certs, pinned))
      throw Object.assign(Error(`${app.name} ${p.version ?? ""} is signed by a different key (${short(certs[0])}) than the one pinned on ${st.sourceCert.firstSeen.slice(0, 10)} (${short(pinned[0])}). The download may have been tampered with. If the developer really changed keys, choose "Trust new signature" in Relevance.`.replace("  ", " ")), { attention: "signature-changed" });
    ok("Signature matches the pinned original");
  } else
    await updateState(app.id, (s) => s.sourceCert = { sha256: certs, firstSeen: (/* @__PURE__ */ new Date()).toISOString(), version: p.version || void 0 }, `relevance: pin original signature of ${app.name}`), ok("Pinned the original signature — future downloads must match it");
}
var planPath = () => `${WORK}/plan.json`, loadPlan = () => readJson(planPath(), null);
function getApp(cfg, id) {
  let app = cfg.apps.find((a) => a.id === id);
  if (!app)
    throw Error(`App "${id}" is not in relevance.json`);
  return app;
}
function patchSourceFor(cfg, app) {
  if (app.tool === "none")
    return null;
  let all = [...BUILTIN_SOURCES, ...cfg.patchSources || []];
  return all.find((s) => s.id === app.patchSourceId && s.tool === app.tool) || all.find((s) => s.builtin && s.tool === app.tool) || null;
}
function buildTools() {
  let sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || "/usr/local/lib/android/sdk", dir = join2(sdk, "build-tools"), vers = readdirSync2(dir).sort((a, b) => b.localeCompare(a, void 0, { numeric: !0 }));
  return join2(dir, vers[0]);
}
async function apkInfo(apk) {
  let out = await run(join2(buildTools(), "aapt2"), ["dump", "badging", apk], { quiet: !0 }).catch(async () => run(join2(buildTools(), "aapt"), ["dump", "badging", apk], { quiet: !0 })), m = out.match(/package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'/);
  if (!m)
    throw Error("Could not read the APK manifest");
  return { packageName: m[1], versionCode: Number(m[2]), versionName: m[3], label: out.match(/application-label:'([^']*)'/)?.[1] };
}
async function plan(appId, opts) {
  let cfg = loadConfig(), app = getApp(cfg, appId), state = loadState(appId);
  info(`Planning build for ${app.name} (${app.packageName})`);
  let hash = await configHash(app), index = null, ps = patchSourceFor(cfg, app);
  if (ps && app.tool !== "lspatch")
    if (index = await loadIndex(ps), index)
      ok(`Loaded ${ps.name} patch index ${index.version} (${index.patches.length} patches)`);
    else
      warn(`No patch index for ${ps.name}; version selection falls back to the latest`);
  let available = null;
  try {
    let sv = await sourceVersions(app);
    available = sv.versions, ok(`Source offers ${available ? available.length + " versions, latest " + (sv.latest || available[0]) : "the latest version only"}`);
  } catch (e) {
    if (app.source.type === "apkpure")
      throw e;
    warn(`Could not list source versions: ${shortErr(e)}`);
  }
  if (index && app.tool !== "lspatch") {
    let missing = app.patches.filter((p) => !findPatch(index, p.name, app.packageName)).map((p) => p.name);
    if (missing.length)
      throw Object.assign(Error(`Selected patches no longer exist in ${index.name} ${index.version}: ${missing.join(", ")}`), {
        attention: "selection-changed"
      });
  }
  let t = app.tool === "revanced" || app.tool === "morphe" ? pickTarget(index, app.packageName, app.patches, available, app.pin) : pickTarget(null, app.packageName, [], available, app.pin);
  if (t.conflict)
    throw Object.assign(Error(t.reason), { attention: "no-compatible-version" });
  log(`Target version: ${t.target ?? "latest"} — ${t.reason}`);
  let dl = await sourceDownload(app, t.target), version = dl.version || t.target, same = state.current && version && (state.current.sourceVersion ?? state.current.version) === version && state.configHash === hash && (!index || state.patchVersion === index.version), p = {
    appId,
    version: version || null,
    reason: t.reason,
    download: { url: dl.url, fileName: dl.fileName, version: dl.version },
    configHash: hash,
    patchVersion: index?.version,
    expectedSignatures: expectedSignatures(index, app.packageName),
    expectedFrom: index ? `${index.name} ${index.version}` : void 0,
    skip: Boolean(same && !opts.force),
    rebuild: needsRebuild(app),
    trigger: opts.trigger,
    startedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (writeJson(planPath(), p), p.skip)
    ok(`Already built ${version} with this configuration — nothing to do (use "Rebuild" to force)`);
  setOutput("skip", String(p.skip)), setOutput("rebuild", String(p.rebuild)), setOutput("customize", String(Boolean(app.customize?.name || app.customize?.packageName || app.customize?.icon))), setOutput("patch", String(app.tool !== "none")), await updateState(appId, (s) => {
    s.status = "building", s.targetVersion = version || void 0, s.history.unshift({ runId: RUN_ID, version: version || void 0, status: "running", at: p.startedAt, trigger: opts.trigger }), s.history = s.history.filter((h, i, arr) => arr.findIndex((x) => x.runId === h.runId) === i);
  }, `relevance: building ${app.name} ${version ?? ""}`.trim());
}
function zipEntries(file) {
  let buf = readFileSync3(file), eocd = -1;
  for (let i = buf.length - 22;i >= Math.max(0, buf.length - 66000); i--)
    if (buf.readUInt32LE(i) === 101010256) {
      eocd = i;
      break;
    }
  if (eocd < 0)
    return [];
  let cdSize = buf.readUInt32LE(eocd + 12), cdOff = buf.readUInt32LE(eocd + 16);
  if (cdOff === 4294967295) {
    let loc = eocd - 20;
    if (buf.readUInt32LE(loc) === 117853008) {
      let z64 = Number(buf.readBigUInt64LE(loc + 8));
      cdSize = Number(buf.readBigUInt64LE(z64 + 40)), cdOff = Number(buf.readBigUInt64LE(z64 + 48));
    }
  }
  let names = [], p = cdOff;
  while (p < cdOff + cdSize && buf.readUInt32LE(p) === 33639248) {
    let n = buf.readUInt16LE(p + 28), e = buf.readUInt16LE(p + 30), c = buf.readUInt16LE(p + 32);
    names.push(buf.toString("utf8", p + 46, p + 46 + n)), p += 46 + n + e + c;
  }
  return names;
}
async function fetchApk(appId) {
  let p = loadPlan(), cfg = loadConfig(), app = getApp(cfg, appId);
  if (!p.download)
    throw Error("Nothing to download");
  let raw = `${WORK}/download.bin`;
  if (p.download.url.startsWith("apkeep:")) {
    let [pkg, ver] = p.download.url.slice(7).split("@");
    renameSync(await apkeepDownload(pkg, ver), raw);
  } else {
    info(`Fetching ${app.name} ${p.version ?? ""} from ${new URL(p.download.url).host}`);
    let headers = {};
    if (app.source.type === "upload" || p.download.url.includes(`github.com/${REPO}/`))
      headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
    await download(p.download.url, raw, headers);
  }
  let names = zipEntries(raw), looksApk = names.includes("AndroidManifest.xml"), isBundle = !looksApk && names.some((n) => /\.apk$/i.test(n)), input = `${WORK}/input.apk`, certs;
  if (looksApk)
    renameSync(raw, input), certs = await apkCerts(input);
  else if (isBundle) {
    let bundle = `${WORK}/bundle.xapk`;
    renameSync(raw, bundle);
    let splits = `${WORK}/splits`;
    rmSync(splits, { recursive: !0, force: !0 }), mkdirSync3(splits, { recursive: !0 }), await run("python3", ["-c", `import zipfile,sys
z=zipfile.ZipFile(sys.argv[1])
for n in z.namelist():
  if n.endswith(".apk"): z.extract(n, sys.argv[2])`, bundle, splits], { quiet: !0 });
    let files = readdirSync2(splits, { recursive: !0 }).map(String).filter((f) => f.endsWith(".apk"));
    if (!files.length)
      throw Error("The bundle contains no APKs");
    let sets = await Promise.all(files.map((f) => apkCerts(join2(splits, f))));
    if (certs = sets[0], sets.some((c) => !c.some((x) => certs.includes(x))))
      throw Error("The split APKs in this bundle are signed by different keys — refusing to use it");
    ok(`All ${files.length} split APKs carry valid signatures from the same key`), info("Split APK bundle detected — merging into a single APK with APKEditor");
    let ed = await fetchCli("apkeditor");
    await run("java", ["-jar", ed, "m", "-i", bundle, "-o", input, "-f"]);
  } else
    throw Error("The downloaded file is not an APK");
  let meta = await apkInfo(input);
  if (ok(`${meta.packageName} ${meta.versionName} (${meta.versionCode}), ${(statSync(input).size / 1048576).toFixed(1)} MB`), p.version && meta.versionName !== p.version) {
    if (app.source.type === "apkpure" || app.source.type === "fdroid")
      throw Error(`The source delivered version ${meta.versionName}, but ${p.version} was requested`);
    if (app.source.type !== "upload")
      log(`Note: release ${p.version} contains app version ${meta.versionName}`);
  }
  if (meta.packageName !== app.packageName)
    warn(`Package name ${meta.packageName} differs from the configured ${app.packageName}`);
  if (await checkOriginal(app, p, certs), writeJson(`${WORK}/input.json`, meta), copyFileSync(input, `${WORK}/current.apk`), isBundle && !p.rebuild)
    info("A merged bundle has no valid signature — signing it with your key"), await sign(appId);
}
function optionArg(v) {
  if (v === null || v === void 0)
    return "";
  if (Array.isArray(v))
    return `[${v.map((x) => optionArg(x).replace(/,/g, "\\,")).join(",")}]`;
  if (typeof v === "string")
    return v.replace(/(["'])/g, "\\$1");
  return String(v);
}
function solidPng(size, hex) {
  let m = /^#?([0-9a-f]{6})$/i.exec(hex.trim()) || [, "ffffff"], [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)), row = Buffer.alloc(1 + size * 3);
  for (let x = 0;x < size; x++)
    row.set([r, g, b], 1 + x * 3);
  let raw = Buffer.concat(Array.from({ length: size }, () => row)), crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0;k < 8; k++)
      c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    return c >>> 0;
  }), crc = (buf) => {
    let c = 4294967295;
    for (let byte of buf)
      c = crcTable[(c ^ byte) & 255] ^ c >>> 8;
    return (c ^ 4294967295) >>> 0;
  }, chunk = (type, data) => {
    let len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    let td = Buffer.concat([Buffer.from(type), data]), c = Buffer.alloc(4);
    return c.writeUInt32BE(crc(td)), Buffer.concat([len, td, c]);
  }, ihdr = Buffer.alloc(13);
  return ihdr.writeUInt32BE(size, 0), ihdr.writeUInt32BE(size, 4), ihdr.set([8, 2, 0, 0, 0], 8), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
var DENSITIES = [["mdpi", 108], ["hdpi", 162], ["xhdpi", 216], ["xxhdpi", 324], ["xxxhdpi", 432]];
async function resizePng(src, outs) {
  let file = `${WORK}/tools/Resize.java`;
  mkdirSync3(`${WORK}/tools`, { recursive: !0 }), writeFileSync2(file, `import java.awt.*; import java.awt.image.*; import javax.imageio.ImageIO; import java.io.File;
public class Resize { public static void main(String[] a) throws Exception {
  BufferedImage in = ImageIO.read(new File(a[0]));
  for (int i = 1; i + 1 < a.length; i += 2) {
    int s = Integer.parseInt(a[i + 1]);
    Image sc = in.getScaledInstance(s, s, Image.SCALE_AREA_AVERAGING);
    BufferedImage out = new BufferedImage(s, s, BufferedImage.TYPE_INT_ARGB);
    Graphics2D g = out.createGraphics(); g.drawImage(sc, 0, 0, null); g.dispose();
    ImageIO.write(out, "png", new File(a[i]));
  } } }`), await run("java", ["-Djava.awt.headless=true", file, src, ...outs], { quiet: !0 });
}
async function brandWithPatches(app, index, selected) {
  let c = app.customize || {}, done = { via: [] };
  if (!index || app.tool !== "morphe" && app.tool !== "revanced")
    return done;
  let prefix = app.tool, select = (name) => {
    let s = selected.find((x) => x.name === name);
    if (!s)
      selected.push(s = { name, options: {} });
    if (!done.via.includes(name))
      done.via.push(name);
    return s;
  }, brand = findPatch(index, "Custom branding", app.packageName), opts = brand?.options || [], nameKey = opts.find((o) => /name/i.test(o.key))?.key, iconKey = opts.find((o) => /custom ?icon/i.test(o.key))?.key, fg = c.icon?.path?.replace(/\.png$/, "-fg.png"), canIcon = Boolean(c.icon && iconKey && fg && existsSync4(fg)), chosen = selected.some((x) => x.name === "Custom branding"), appIconKey = opts.find((o) => /^appIcon$/i.test(o.key))?.key;
  if (brand && (chosen || canIcon || c.name && nameKey && appIconKey)) {
    if (!chosen && !canIcon && appIconKey)
      select("Custom branding").options[appIconKey] = "original";
    if (c.name && nameKey)
      select("Custom branding").options[nameKey] = c.name, done.name = !0;
    if (canIcon) {
      let dir = `${WORK}/branding`;
      rmSync(dir, { recursive: !0, force: !0 });
      let bg = readJson(c.icon.path.replace(/\.png$/, ".json"), {}).background || "#FFFFFF", jobs = [];
      for (let [d, px] of DENSITIES)
        mkdirSync3(`${dir}/mipmap-${d}`, { recursive: !0 }), jobs.push(`${dir}/mipmap-${d}/${prefix}_adaptive_foreground_custom.png`, String(px)), writeFileSync2(`${dir}/mipmap-${d}/${prefix}_adaptive_background_custom.png`, solidPng(px, bg));
      await resizePng(fg, jobs);
      let s = select("Custom branding");
      if (s.options[iconKey] = resolve(dir), appIconKey)
        s.options[appIconKey] = "custom";
      done.icon = !0;
    }
  }
  let pkgPatch = c.packageName && c.packageName !== app.packageName ? findPatch(index, "Change package name", app.packageName) : null, pkgKey = pkgPatch?.options?.find((o) => /package/i.test(o.key))?.key;
  if (pkgPatch && pkgKey) {
    let s = select("Change package name");
    s.options[pkgKey] = c.packageName;
    for (let o of pkgPatch.options || [])
      if (/providers|permissions/i.test(o.key) && s.options[o.key] === void 0)
        s.options[o.key] = !0;
    done.packageName = !0;
  }
  if (done.name || done.icon || done.packageName) {
    let what = [done.name && "name", done.icon && "icon", done.packageName && "package name"].filter(Boolean).join(", ");
    info(`Applying your ${what} with ${done.via.join(" + ")} (no apktool round trip needed)`);
  }
  return done;
}
async function patch(appId) {
  let cfg = loadConfig(), app = getApp(cfg, appId), p = loadPlan(), input = `${WORK}/current.apk`, out = `${WORK}/patched.apk`;
  if (app.tool === "none")
    return log("No patching tool selected — skipping");
  let custom = app.customPatches.filter((c) => c.enabled);
  if (app.tool === "lspatch") {
    let jar = await fetchCli("lspatch"), ps = patchSourceFor(cfg, app), index = ps ? await loadIndex(ps) : null, mods = [], i = 0;
    for (let sel of app.patches) {
      let repo = findPatch(index, sel.name, app.packageName)?.module?.repo || sel.name;
      mods.push(await moduleApk(repo, `${WORK}/modules/m${i++}.apk`));
    }
    for (let c of custom)
      mods.push(await moduleApk(c.url, `${WORK}/modules/m${i++}.apk`));
    if (!mods.length)
      warn("No Xposed modules selected; LSPatch will only add the loader");
    let outDir = `${WORK}/lspatch-out`;
    rmSync(outDir, { recursive: !0, force: !0 }), await run("java", ["-jar", jar, input, "-l", "2", "-f", "-o", outDir, ...mods.flatMap((m) => ["-m", m])]);
    let f = readdirSync2(outDir).find((n) => n.endsWith(".apk"));
    if (!f)
      throw Error("LSPatch produced no output");
    renameSync(join2(outDir, f), out);
  } else {
    let ps = patchSourceFor(cfg, app);
    if (!ps)
      throw Error(`No ${app.tool} patch source configured`);
    let cli = await fetchCli(app.tool), main = await fetchBundle(ps), bundles = [main.file];
    for (let c of custom) {
      let b = await fetchBundle({ tool: app.tool, url: c.url, id: c.id });
      if (!bundles.includes(b.file))
        bundles.push(b.file);
    }
    let args = ["-jar", cli, "patch"];
    for (let b of bundles)
      args.push("-p", b, ...app.tool === "revanced" ? ["-b"] : []);
    args.push("--exclusive");
    let selected = app.patches.map((x) => ({ name: x.name, options: { ...x.options || {} } })), handled = await brandWithPatches(app, await loadIndex(ps), selected);
    for (let sel of selected) {
      args.push("-e", sel.name);
      for (let [k, v] of Object.entries(sel.options)) {
        if (v === void 0 || v === "" || v === null)
          continue;
        args.push(`-O${k}=${optionArg(v)}`);
      }
    }
    writeJson(`${WORK}/branding.json`, handled);
    for (let c of custom)
      for (let n of c.patchNames?.length ? c.patchNames : [c.name])
        args.push("-e", n);
    if (app.pin)
      args.push("-f");
    args.push("-o", out, "-t", `${WORK}/tmp`, input), log(`Applying ${app.patches.length + custom.length} patches with ${ps.name} ${main.version}`), await run("java", args);
  }
  if (!existsSync4(out))
    throw Error("Patching produced no APK");
  ok(`Patched APK ready (${(statSync(out).size / 1048576).toFixed(1)} MB)`), copyFileSync(out, `${WORK}/current.apk`), writeJson(`${WORK}/patched.json`, { patchVersion: p.patchVersion });
}
var xmlEscape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "\\'");
function rewriteManifest(xml, opts) {
  let m = xml;
  if (opts.label) {
    let label = xmlEscape(opts.label);
    m = m.replace(/<application\b[^>]*>/, (tag) => /android:label=/.test(tag) ? tag.replace(/android:label="[^"]*"/, `android:label="${label}"`) : tag.replace("<application", `<application android:label="${label}"`)), m = m.replace(/<(activity|activity-alias)\b([^>]*)>([\s\S]*?)<\/\1>/g, (whole, tag, attrs, body) => {
      if (!/android\.intent\.category\.LAUNCHER/.test(body))
        return whole;
      let a = /android:label=/.test(attrs) ? attrs.replace(/android:label="[^"]*"/, `android:label="${label}"`) : `${attrs} android:label="${label}"`;
      return `<${tag}${a}>${body}</${tag}>`;
    });
  }
  if (opts.icon) {
    let setIcon = (tag) => {
      let t = tag;
      return t = /android:icon=/.test(t) ? t.replace(/android:icon="[^"]*"/, 'android:icon="@mipmap/relevance_icon"') : t.replace(/^<(\S+)/, '<$1 android:icon="@mipmap/relevance_icon"'), t = /android:roundIcon=/.test(t) ? t.replace(/android:roundIcon="[^"]*"/, 'android:roundIcon="@mipmap/relevance_icon"') : t, t;
    };
    m = m.replace(/<application\b[^>]*>/, setIcon), m = m.replace(/<(activity|activity-alias)\b[^>]*android:icon="[^"]*"[^>]*>/g, setIcon);
  }
  if (opts.newPkg && opts.newPkg !== opts.oldPkg) {
    let { oldPkg: oldP, newPkg: newP } = opts;
    m = m.replace(/(<(?:activity|activity-alias|service|receiver|provider|application|instrumentation)\b[^>]*?android:(?:name|targetActivity|backupAgent)=")\.([^"]+)"/g, `$1${oldP}.$2"`), m = m.replace(/(<(?:activity|activity-alias|service|receiver|provider|application)\b[^>]*?android:(?:name|targetActivity)=")\.([^"]+)"/g, `$1${oldP}.$2"`), m = m.replace(/(<manifest\b[^>]*?\spackage=")[^"]+"/, `$1${newP}"`), m = m.replace(/android:authorities="([^"]*)"/g, (_, v) => `android:authorities="${v.split(";").map((a) => a.startsWith(oldP) ? newP + a.slice(oldP.length) : `${newP}.${a}`).join(";")}"`);
    let perms = [...m.matchAll(/<permission\b[^>]*android:name="([^"]+)"/g)].map((x) => x[1]);
    for (let perm of perms) {
      let np = perm.startsWith(oldP) ? newP + perm.slice(oldP.length) : `${newP}.${perm}`;
      m = m.split(`"${perm}"`).join(`"${np}"`);
    }
    m = m.replace(/android:taskAffinity="([^"]*)"/g, (_, v) => `android:taskAffinity="${v.startsWith(oldP) ? newP + v.slice(oldP.length) : v}"`);
  }
  return m;
}
function invalidQualifierDirs(resDir) {
  if (!existsSync4(resDir))
    return [];
  return readdirSync2(resDir).filter((d) => d.split("-").slice(1).some((q) => /^(mcc|mnc)\d{4,}$/.test(q)));
}
function dropConfigs(resDir, dirs) {
  if (!dirs.length)
    return;
  for (let d of dirs)
    rmSync(join2(resDir, d), { recursive: !0, force: !0 });
  warn(`Dropped ${dirs.length} resource folder${dirs.length === 1 ? "" : "s"} for configurations no device can have (${dirs.slice(0, 4).join(", ")}${dirs.length > 4 ? ", …" : ""})`);
}
async function customize(appId) {
  let cfg = loadConfig(), app = getApp(cfg, appId), handled = readJson(`${WORK}/branding.json`, {}), all = app.customize || {}, c = { name: handled.name ? void 0 : all.name, packageName: handled.packageName ? void 0 : all.packageName, icon: handled.icon ? void 0 : all.icon };
  if (!c.name && !c.packageName && !c.icon) {
    if (handled.via?.length)
      return ok(`Name, icon and package were already applied by ${handled.via.join(" + ")} — nothing left to decompile`);
    return log("No basic modifications — skipping");
  }
  if (handled.via?.length)
    info(`${handled.via.join(" + ")} took care of part of it`);
  if (!c.icon) {
    info("Editing the compiled manifest (no decompile needed)");
    let apk = resolve(`${WORK}/current.apk`), tmp = `${WORK}/manifest-edit`;
    rmSync(tmp, { recursive: !0, force: !0 }), mkdirSync3(tmp, { recursive: !0 }), await run("python3", ["-I", "-c", 'import sys,zipfile;open(sys.argv[2],"wb").write(zipfile.ZipFile(sys.argv[1]).read("AndroidManifest.xml"))', apk, `${tmp}/AndroidManifest.xml`], { quiet: !0 });
    let r = editManifest(readFileSync3(`${tmp}/AndroidManifest.xml`), { packageName: c.packageName, label: c.name });
    writeFileSync2(`${tmp}/AndroidManifest.xml`, r.bytes), await run("zip", ["-q", apk, "AndroidManifest.xml"], { cwd: tmp, quiet: !0 });
    for (let ch of r.changes)
      ok(ch.charAt(0).toUpperCase() + ch.slice(1));
    let after = await apkInfo(apk);
    if (c.packageName && after.packageName !== c.packageName)
      throw Error(`Manifest edit failed: package is ${after.packageName}`);
    return ok("Customized APK ready");
  }
  let apktool = await fetchCli("apktool"), dec = `${WORK}/decoded`;
  rmSync(dec, { recursive: !0, force: !0 }), info("Decompiling resources (code stays untouched)"), await run("java", ["-jar", apktool, "d", "-f", "-s", "-o", dec, `${WORK}/current.apk`]);
  let meta = readJson(`${WORK}/input.json`, { packageName: app.packageName }), manifestPath = join2(dec, "AndroidManifest.xml"), xml = readFileSync3(manifestPath, "utf8"), curPkg = xml.match(/<manifest\b[^>]*package="([^"]+)"/)?.[1] || meta.packageName, resDir = join2(dec, "res");
  for (let d of existsSync4(resDir) ? readdirSync2(resDir) : []) {
    let dir = join2(resDir, d);
    for (let f of readdirSync2(dir))
      if (f.startsWith("relevance_icon"))
        rmSync(join2(dir, f));
      else if (d.startsWith("values") && f.endsWith(".xml") && f !== "public.xml") {
        let t = readFileSync3(join2(dir, f), "utf8"), n = t.replace(/^\s*<(color|drawable|mipmap)\s+name="relevance_icon[^"]*"[^>]*(?:\/>|>[^<]*<\/\1>)\s*$/gm, "");
        if (n !== t)
          writeFileSync2(join2(dir, f), n);
      }
  }
  if (c.icon) {
    let iconFile = c.icon.path;
    if (!existsSync4(iconFile))
      throw Error(`Icon ${iconFile} not found in repository`);
    for (let d of ["mipmap-xxxhdpi", "mipmap-anydpi-v26", "values"])
      mkdirSync3(join2(dec, "res", d), { recursive: !0 });
    copyFileSync(iconFile, join2(dec, "res/mipmap-xxxhdpi/relevance_icon_legacy.png"));
    let fg = iconFile.replace(/\.png$/, "-fg.png");
    if (existsSync4(fg)) {
      copyFileSync(fg, join2(dec, "res/mipmap-xxxhdpi/relevance_icon_fg.png"));
      let bg = readJson(iconFile.replace(/\.png$/, ".json"), {}).background || "#FFFFFF";
      writeFileSync2(join2(dec, "res/values/relevance_icon.xml"), `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="relevance_icon_bg">${bg}</color>
</resources>
`), writeFileSync2(join2(dec, "res/mipmap-anydpi-v26/relevance_icon.xml"), `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/relevance_icon_bg"/>
  <foreground android:drawable="@mipmap/relevance_icon_fg"/>
</adaptive-icon>
`), copyFileSync(iconFile, join2(dec, "res/mipmap-xxxhdpi/relevance_icon.png")), rmSync(join2(dec, "res/mipmap-xxxhdpi/relevance_icon_legacy.png"));
    } else
      renameSync(join2(dec, "res/mipmap-xxxhdpi/relevance_icon_legacy.png"), join2(dec, "res/mipmap-xxxhdpi/relevance_icon.png"));
    ok("Installed the new launcher icon");
  }
  let next = rewriteManifest(xml, { oldPkg: curPkg, newPkg: c.packageName, label: c.name, icon: Boolean(c.icon) });
  if (writeFileSync2(manifestPath, next), c.name)
    ok(`Renamed the app to "${c.name}"`);
  if (c.packageName && c.packageName !== curPkg)
    ok(`Package name ${curPkg} → ${c.packageName}`);
  info("Rebuilding APK"), dropConfigs(resDir, invalidQualifierDirs(resDir));
  try {
    await run("java", ["-jar", apktool, "b", "-o", `${WORK}/customized.apk`, dec]);
  } catch (e) {
    let bad = [...new Set([...String(e.output || "").matchAll(/res\/([^/\s]+)\/[^:\s]+: error: invalid configuration/g)].map((m) => m[1]))];
    if (!bad.length)
      throw e;
    dropConfigs(resDir, bad), info("Rebuilding APK again"), await run("java", ["-jar", apktool, "b", "-o", `${WORK}/customized.apk`, dec]);
  }
  copyFileSync(`${WORK}/customized.apk`, `${WORK}/current.apk`), ok("Customized APK ready");
}
async function sign(appId) {
  let bt = buildTools(), alias = loadConfig().settings.signing?.alias || env.RELEVANCE_KEY_ALIAS || "relevance", ks = `${WORK}/keystore.p12`;
  if (!env.RELEVANCE_KEYSTORE)
    throw Error("Signing key secret RELEVANCE_KEYSTORE is missing — open Relevance settings to set it up");
  writeFileSync2(ks, Buffer.from(env.RELEVANCE_KEYSTORE, "base64"));
  let aligned = `${WORK}/aligned.apk`, signed = `${WORK}/signed.apk`;
  info("Aligning"), await run(join2(bt, "zipalign"), ["-p", "-f", "4", `${WORK}/current.apk`, aligned], { quiet: !0 }), info("Signing with your repository key (v1 + v2 + v3)"), await run(join2(bt, "apksigner"), [
    "sign",
    "--ks",
    ks,
    "--ks-type",
    "PKCS12",
    "--ks-pass",
    "env:RELEVANCE_KEYSTORE_PASSWORD",
    "--key-pass",
    "env:RELEVANCE_KEYSTORE_PASSWORD",
    "--ks-key-alias",
    alias,
    "--v1-signing-enabled",
    "true",
    "--v2-signing-enabled",
    "true",
    "--v3-signing-enabled",
    "true",
    "--out",
    signed,
    aligned
  ]);
  let fp = (await run(join2(bt, "apksigner"), ["verify", "--print-certs", signed], { quiet: !0 })).match(/SHA-256 digest: ([0-9a-f]+)/)?.[1];
  ok(`Signed${fp ? ` — certificate ${fp.slice(0, 16)}…` : ""}`), copyFileSync(signed, `${WORK}/current.apk`), rmSync(ks);
}
async function uploadAsset(uploadUrl, file, name) {
  let url = uploadUrl.replace(/\{.*\}$/, "") + `?name=${encodeURIComponent(name)}`, body = readFileSync3(file), r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Length": String(body.length),
      Accept: "application/vnd.github+json"
    },
    body
  });
  if (!r.ok)
    throw Error(`Asset upload failed: ${r.status} ${await r.text()}`);
  return await r.json();
}
async function publish(appId) {
  let cfg = loadConfig(), app = getApp(cfg, appId), p = loadPlan(), file = `${WORK}/current.apk`, meta = await apkInfo(file), size = statSync(file).size, sha256 = createHash2("sha256").update(readFileSync3(file)).digest("hex"), tag = `${app.id}-${meta.versionName.replace(/[^\w.-]/g, "_")}-${p.configHash.slice(0, 6)}`, apkName = `${meta.packageName}_${meta.versionCode}_${p.configHash.slice(0, 6)}.apk`;
  info(`Publishing ${apkName} as release ${tag}`);
  let rel;
  try {
    rel = await ghApi(`/repos/${REPO}/releases/tags/${encodeURIComponent(tag)}`);
    for (let a of rel.assets)
      await ghApi(`/repos/${REPO}/releases/assets/${a.id}`, { method: "DELETE" });
  } catch {
    let patchList = app.tool === "none" ? [] : app.patches.map((x) => `- ${x.name}`);
    rel = await ghApi(`/repos/${REPO}/releases`, {
      method: "POST",
      body: JSON.stringify({
        tag_name: tag,
        name: `${app.customize?.name || app.name} ${meta.versionName}`,
        body: [
          `Built by Relevance from ${app.source.type} — ${app.tool === "none" ? "unmodified" : `patched with ${app.tool}`}.`,
          "",
          ...patchList.length ? ["**Patches**", ...patchList, ""] : [],
          `SHA-256: \`${sha256}\``
        ].join(`
`),
        make_latest: "false"
      })
    });
  }
  let asset = await uploadAsset(rel.upload_url, file, apkName);
  ok(`Uploaded ${(size / 1048576).toFixed(1)} MB`);
  let entry = {
    version: meta.versionName,
    versionCode: meta.versionCode,
    tag,
    date: (/* @__PURE__ */ new Date()).toISOString(),
    size,
    sha256,
    apk: apkName,
    url: asset.browser_download_url,
    patches: app.tool === "none" ? [] : [...app.patches.map((x) => x.name), ...app.customPatches.filter((c) => c.enabled).map((c) => c.name)],
    tool: app.tool,
    patchVersion: p.patchVersion,
    sourceVersion: p.version || meta.versionName
  }, started = new Date(p.startedAt).getTime();
  await updateState(appId, (s) => {
    s.status = "ok", s.current = entry, s.configHash = p.configHash, s.patchVersion = p.patchVersion, s.attention = null, s.releases = [entry, ...(s.releases || []).filter((r) => r.tag !== tag)];
    let h = s.history.find((x) => x.runId === RUN_ID);
    if (h)
      Object.assign(h, { status: "success", version: meta.versionName, durationMs: Date.now() - started });
  }, `relevance: published ${app.name} ${meta.versionName}`), ok(`${app.customize?.name || app.name} ${meta.versionName} is live`);
}
async function finishSkipped(appId) {
  await updateState(appId, (s) => {
    s.status = s.current ? "ok" : "never";
    let h = s.history.find((x) => x.runId === RUN_ID);
    if (h)
      h.status = "skipped";
  }, "relevance: nothing to build");
}
async function fail(appId, opts) {
  let cfg = loadConfig(), app = cfg.apps.find((a) => a.id === appId), p = loadPlan(), errFile = `${WORK}/error.json`, err = readJson(errFile, {}), message = opts.error || err.message || "The build failed — open the build log for details";
  if (opts.cancelled) {
    await updateState(appId, (s) => {
      s.status = s.current ? "ok" : "never";
      let h = s.history.find((x) => x.runId === RUN_ID);
      if (h)
        h.status = "cancelled";
    }, "relevance: build cancelled");
    return;
  }
  let kind = err.attention || "build-failed", version = p?.version || void 0, st = await updateState(appId, (s) => {
    s.status = kind === "build-failed" ? "failed" : "needs-review", s.attention = {
      kind,
      message: kind === "build-failed" ? `Building ${version ? "version " + version : "the update"} failed${err.step ? ` during "${err.step}"` : ""}. The last good build stays published.` : message,
      at: (/* @__PURE__ */ new Date()).toISOString(),
      version,
      details: [message]
    };
    let h = s.history.find((x) => x.runId === RUN_ID);
    if (h)
      Object.assign(h, { status: "failure", error: message });
    else
      s.history.unshift({ runId: RUN_ID, status: "failure", at: (/* @__PURE__ */ new Date()).toISOString(), trigger: "manual", error: message, version });
  }, `relevance: ${app?.name || appId} needs attention`);
  if (app)
    await notify(cfg, app, st);
}
function recordError(step, e) {
  let attention = e?.attention;
  writeJson(`${WORK}/error.json`, { step, message: shortErr(e), attention });
}

// engine/check.ts
import { writeFileSync as writeFileSync3, mkdirSync as mkdirSync4 } from "node:fs";
async function indexCustomSources() {
  let cfg = loadConfig();
  for (let src of cfg.patchSources.filter((s) => !s.builtin))
    try {
      info(`Indexing ${src.name}`);
      let idx = await indexSource(src);
      await putFile(`.relevance/index/${src.id}.json`, () => JSON.stringify(idx, null, 1) + `
`, `relevance: index ${src.name} ${idx.version}`), mkdirSync4(".relevance/index", { recursive: !0 }), writeFileSync3(`.relevance/index/${src.id}.json`, JSON.stringify(idx)), ok(`${src.name}: ${idx.patches.length} patches (${idx.version})`);
    } catch (e) {
      warn(`Could not index ${src.name}: ${shortErr(e)}`);
    }
}
async function indexBuiltin(outDir) {
  mkdirSync4(outDir, { recursive: !0 });
  for (let src of BUILTIN_SOURCES)
    try {
      let idx = await indexSource(src);
      writeFileSync3(`${outDir}/${src.id}.json`, JSON.stringify(idx)), ok(`${src.name}: ${idx.patches.length} entries (${idx.version})`);
    } catch (e) {
      warn(`Could not index ${src.name}: ${shortErr(e)}`);
    }
}
async function checkUpdates(only) {
  await indexCustomSources();
  let cfg = loadConfig(), toBuild = [];
  for (let app of cfg.apps) {
    if (only && app.id !== only)
      continue;
    if (!app.enabled)
      continue;
    let st = loadState(app.id), hash = await configHash(app);
    try {
      info(`Checking ${app.name}`);
      let ps = patchSourceFor(cfg, app), index = ps && app.tool !== "lspatch" ? await loadIndex(ps) : null;
      if (index) {
        let missing = app.patches.filter((p) => !findPatch(index, p.name, app.packageName)).map((p) => p.name);
        if (missing.length) {
          let msg = `Patches you picked are no longer offered by ${index.name} ${index.version}: ${missing.join(", ")}`;
          if (st.attention?.message !== msg) {
            let s2 = await updateState(app.id, (s) => {
              s.status = "needs-review", s.attention = { kind: "selection-changed", message: msg, at: (/* @__PURE__ */ new Date()).toISOString(), details: missing }, s.checkedAt = (/* @__PURE__ */ new Date()).toISOString();
            }, `relevance: ${app.name} needs a review`);
            await notify(cfg, app, s2);
          }
          warn(msg);
          continue;
        }
      }
      let available = null, latest, auto = sourceAutoUpdates(app.source.type);
      if (auto) {
        let sv = await sourceVersions(app);
        available = sv.versions, latest = sv.latest;
      }
      let t = pickTarget(app.tool === "revanced" || app.tool === "morphe" ? index : null, app.packageName, app.patches, available, app.pin), target = t.target;
      if (!target && auto)
        target = (await sourceDownload(app, null)).version || null;
      let changed = !st.current || st.configHash !== hash || index && st.patchVersion !== index.version || auto && target && target !== (st.current.sourceVersion ?? st.current.version);
      if (await updateState(app.id, (s) => {
        s.checkedAt = (/* @__PURE__ */ new Date()).toISOString(), s.latestAvailable = latest, s.targetVersion = target || void 0;
      }, `relevance: checked ${app.name}`), t.conflict) {
        warn(`${app.name}: ${t.reason}`);
        continue;
      }
      if (changed && st.status !== "failed")
        log(`→ ${app.name}: build ${target ?? "latest"} (current ${st.current?.version ?? "none"})`), toBuild.push(app.id);
      else if (changed && st.status === "failed" && st.attention?.version !== target)
        log(`→ ${app.name}: new version ${target} after a failed build — retrying`), toBuild.push(app.id);
      else
        ok(`${app.name} is up to date (${st.current?.version ?? "—"})`);
    } catch (e) {
      warn(`${app.name}: ${shortErr(e)}`);
    }
  }
  for (let id of toBuild)
    await ghApi(`/repos/${REPO}/actions/workflows/relevance-build.yml/dispatches`, {
      method: "POST",
      body: JSON.stringify({ ref: env.GITHUB_REF_NAME || "main", inputs: { app: id, trigger: "schedule", force: "false" } })
    }), ok(`Queued a build for ${id}`);
  if (!toBuild.length)
    ok("Everything is up to date");
}

// shared/companions.ts
function companionIcon(app) {
  if (app.packageName !== "app.revanced.android.gms")
    return;
  if (/MorpheApp\/MicroG-RE/i.test(app.source.url))
    return "https://raw.githubusercontent.com/MorpheApp/MicroG-RE/main/play-services-core/src/main/res/mipmap-xxxhdpi/ic_app.png";
  if (/ReVanced\/GmsCore/i.test(app.source.url))
    return "https://raw.githubusercontent.com/ReVanced/GmsCore/main/play-services-core/src/main/res/mipmap-xxxhdpi/ic_app.png";
  return;
}

// engine/site.ts
import { copyFileSync as copyFileSync2, existsSync as existsSync5, mkdirSync as mkdirSync5, readdirSync as readdirSync3, rmSync as rmSync2, statSync as statSync2, writeFileSync as writeFileSync4 } from "node:fs";
import { join as join3 } from "node:path";

// node_modules/qrcode-generator/dist/qrcode.mjs
var qrcode = function(typeNumber, errorCorrectionLevel) {
  let _typeNumber = typeNumber, _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel], _modules = null, _moduleCount = 0, _dataCache = null, _dataList = [], _this = {}, makeImpl = function(test, maskPattern) {
    if (_moduleCount = _typeNumber * 4 + 17, _modules = function(moduleCount) {
      let modules = Array(moduleCount);
      for (let row = 0;row < moduleCount; row += 1) {
        modules[row] = Array(moduleCount);
        for (let col = 0;col < moduleCount; col += 1)
          modules[row][col] = null;
      }
      return modules;
    }(_moduleCount), setupPositionProbePattern(0, 0), setupPositionProbePattern(_moduleCount - 7, 0), setupPositionProbePattern(0, _moduleCount - 7), setupPositionAdjustPattern(), setupTimingPattern(), setupTypeInfo(test, maskPattern), _typeNumber >= 7)
      setupTypeNumber(test);
    if (_dataCache == null)
      _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
    mapData(_dataCache, maskPattern);
  }, setupPositionProbePattern = function(row, col) {
    for (let r = -1;r <= 7; r += 1) {
      if (row + r <= -1 || _moduleCount <= row + r)
        continue;
      for (let c = -1;c <= 7; c += 1) {
        if (col + c <= -1 || _moduleCount <= col + c)
          continue;
        if (0 <= r && r <= 6 && (c == 0 || c == 6) || 0 <= c && c <= 6 && (r == 0 || r == 6) || 2 <= r && r <= 4 && 2 <= c && c <= 4)
          _modules[row + r][col + c] = !0;
        else
          _modules[row + r][col + c] = !1;
      }
    }
  }, getBestMaskPattern = function() {
    let minLostPoint = 0, pattern = 0;
    for (let i = 0;i < 8; i += 1) {
      makeImpl(!0, i);
      let lostPoint = QRUtil.getLostPoint(_this);
      if (i == 0 || minLostPoint > lostPoint)
        minLostPoint = lostPoint, pattern = i;
    }
    return pattern;
  }, setupTimingPattern = function() {
    for (let r = 8;r < _moduleCount - 8; r += 1) {
      if (_modules[r][6] != null)
        continue;
      _modules[r][6] = r % 2 == 0;
    }
    for (let c = 8;c < _moduleCount - 8; c += 1) {
      if (_modules[6][c] != null)
        continue;
      _modules[6][c] = c % 2 == 0;
    }
  }, setupPositionAdjustPattern = function() {
    let pos = QRUtil.getPatternPosition(_typeNumber);
    for (let i = 0;i < pos.length; i += 1)
      for (let j = 0;j < pos.length; j += 1) {
        let row = pos[i], col = pos[j];
        if (_modules[row][col] != null)
          continue;
        for (let r = -2;r <= 2; r += 1)
          for (let c = -2;c <= 2; c += 1)
            if (r == -2 || r == 2 || c == -2 || c == 2 || r == 0 && c == 0)
              _modules[row + r][col + c] = !0;
            else
              _modules[row + r][col + c] = !1;
      }
  }, setupTypeNumber = function(test) {
    let bits = QRUtil.getBCHTypeNumber(_typeNumber);
    for (let i = 0;i < 18; i += 1) {
      let mod = !test && (bits >> i & 1) == 1;
      _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
    }
    for (let i = 0;i < 18; i += 1) {
      let mod = !test && (bits >> i & 1) == 1;
      _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
    }
  }, setupTypeInfo = function(test, maskPattern) {
    let data = _errorCorrectionLevel << 3 | maskPattern, bits = QRUtil.getBCHTypeInfo(data);
    for (let i = 0;i < 15; i += 1) {
      let mod = !test && (bits >> i & 1) == 1;
      if (i < 6)
        _modules[i][8] = mod;
      else if (i < 8)
        _modules[i + 1][8] = mod;
      else
        _modules[_moduleCount - 15 + i][8] = mod;
    }
    for (let i = 0;i < 15; i += 1) {
      let mod = !test && (bits >> i & 1) == 1;
      if (i < 8)
        _modules[8][_moduleCount - i - 1] = mod;
      else if (i < 9)
        _modules[8][15 - i - 1 + 1] = mod;
      else
        _modules[8][15 - i - 1] = mod;
    }
    _modules[_moduleCount - 8][8] = !test;
  }, mapData = function(data, maskPattern) {
    let inc = -1, row = _moduleCount - 1, bitIndex = 7, byteIndex = 0, maskFunc = QRUtil.getMaskFunction(maskPattern);
    for (let col = _moduleCount - 1;col > 0; col -= 2) {
      if (col == 6)
        col -= 1;
      while (!0) {
        for (let c = 0;c < 2; c += 1)
          if (_modules[row][col - c] == null) {
            let dark = !1;
            if (byteIndex < data.length)
              dark = (data[byteIndex] >>> bitIndex & 1) == 1;
            if (maskFunc(row, col - c))
              dark = !dark;
            if (_modules[row][col - c] = dark, bitIndex -= 1, bitIndex == -1)
              byteIndex += 1, bitIndex = 7;
          }
        if (row += inc, row < 0 || _moduleCount <= row) {
          row -= inc, inc = -inc;
          break;
        }
      }
    }
  }, createBytes = function(buffer, rsBlocks) {
    let offset = 0, maxDcCount = 0, maxEcCount = 0, dcdata = Array(rsBlocks.length), ecdata = Array(rsBlocks.length);
    for (let r = 0;r < rsBlocks.length; r += 1) {
      let dcCount = rsBlocks[r].dataCount, ecCount = rsBlocks[r].totalCount - dcCount;
      maxDcCount = Math.max(maxDcCount, dcCount), maxEcCount = Math.max(maxEcCount, ecCount), dcdata[r] = Array(dcCount);
      for (let i = 0;i < dcdata[r].length; i += 1)
        dcdata[r][i] = 255 & buffer.getBuffer()[i + offset];
      offset += dcCount;
      let rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount), modPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1).mod(rsPoly);
      ecdata[r] = Array(rsPoly.getLength() - 1);
      for (let i = 0;i < ecdata[r].length; i += 1) {
        let modIndex = i + modPoly.getLength() - ecdata[r].length;
        ecdata[r][i] = modIndex >= 0 ? modPoly.getAt(modIndex) : 0;
      }
    }
    let totalCodeCount = 0;
    for (let i = 0;i < rsBlocks.length; i += 1)
      totalCodeCount += rsBlocks[i].totalCount;
    let data = Array(totalCodeCount), index = 0;
    for (let i = 0;i < maxDcCount; i += 1)
      for (let r = 0;r < rsBlocks.length; r += 1)
        if (i < dcdata[r].length)
          data[index] = dcdata[r][i], index += 1;
    for (let i = 0;i < maxEcCount; i += 1)
      for (let r = 0;r < rsBlocks.length; r += 1)
        if (i < ecdata[r].length)
          data[index] = ecdata[r][i], index += 1;
    return data;
  }, createData = function(typeNumber, errorCorrectionLevel, dataList) {
    let rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel), buffer = qrBitBuffer();
    for (let i = 0;i < dataList.length; i += 1) {
      let data = dataList[i];
      buffer.put(data.getMode(), 4), buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber)), data.write(buffer);
    }
    let totalDataCount = 0;
    for (let i = 0;i < rsBlocks.length; i += 1)
      totalDataCount += rsBlocks[i].dataCount;
    if (buffer.getLengthInBits() > totalDataCount * 8)
      throw "code length overflow. (" + buffer.getLengthInBits() + ">" + totalDataCount * 8 + ")";
    if (buffer.getLengthInBits() + 4 <= totalDataCount * 8)
      buffer.put(0, 4);
    while (buffer.getLengthInBits() % 8 != 0)
      buffer.putBit(!1);
    while (!0) {
      if (buffer.getLengthInBits() >= totalDataCount * 8)
        break;
      if (buffer.put(236, 8), buffer.getLengthInBits() >= totalDataCount * 8)
        break;
      buffer.put(17, 8);
    }
    return createBytes(buffer, rsBlocks);
  };
  _this.addData = function(data, mode) {
    mode = mode || "Byte";
    let newData = null;
    switch (mode) {
      case "Numeric":
        newData = qrNumber(data);
        break;
      case "Alphanumeric":
        newData = qrAlphaNum(data);
        break;
      case "Byte":
        newData = qr8BitByte(data);
        break;
      case "Kanji":
        newData = qrKanji(data);
        break;
      default:
        throw "mode:" + mode;
    }
    _dataList.push(newData), _dataCache = null;
  }, _this.isDark = function(row, col) {
    if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col)
      throw row + "," + col;
    return _modules[row][col];
  }, _this.getModuleCount = function() {
    return _moduleCount;
  }, _this.make = function() {
    if (_typeNumber < 1) {
      let typeNumber = 1;
      for (;typeNumber < 40; typeNumber++) {
        let rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel), buffer = qrBitBuffer();
        for (let i = 0;i < _dataList.length; i++) {
          let data = _dataList[i];
          buffer.put(data.getMode(), 4), buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber)), data.write(buffer);
        }
        let totalDataCount = 0;
        for (let i = 0;i < rsBlocks.length; i++)
          totalDataCount += rsBlocks[i].dataCount;
        if (buffer.getLengthInBits() <= totalDataCount * 8)
          break;
      }
      _typeNumber = typeNumber;
    }
    makeImpl(!1, getBestMaskPattern());
  }, _this.createTableTag = function(cellSize, margin) {
    cellSize = cellSize || 2, margin = typeof margin > "u" ? cellSize * 4 : margin;
    let qrHtml = "";
    qrHtml += '<table style="', qrHtml += " border-width: 0px; border-style: none;", qrHtml += " border-collapse: collapse;", qrHtml += " padding: 0px; margin: " + margin + "px;", qrHtml += '">', qrHtml += "<tbody>";
    for (let r = 0;r < _this.getModuleCount(); r += 1) {
      qrHtml += "<tr>";
      for (let c = 0;c < _this.getModuleCount(); c += 1)
        qrHtml += '<td style="', qrHtml += " border-width: 0px; border-style: none;", qrHtml += " border-collapse: collapse;", qrHtml += " padding: 0px; margin: 0px;", qrHtml += " width: " + cellSize + "px;", qrHtml += " height: " + cellSize + "px;", qrHtml += " background-color: ", qrHtml += _this.isDark(r, c) ? "#000000" : "#ffffff", qrHtml += ";", qrHtml += '"/>';
      qrHtml += "</tr>";
    }
    return qrHtml += "</tbody>", qrHtml += "</table>", qrHtml;
  }, _this.createSvgTag = function(cellSize, margin, alt, title) {
    let opts = {};
    if (typeof arguments[0] == "object")
      opts = arguments[0], cellSize = opts.cellSize, margin = opts.margin, alt = opts.alt, title = opts.title;
    cellSize = cellSize || 2, margin = typeof margin > "u" ? cellSize * 4 : margin, alt = typeof alt === "string" ? { text: alt } : alt || {}, alt.text = alt.text || null, alt.id = alt.text ? alt.id || "qrcode-description" : null, title = typeof title === "string" ? { text: title } : title || {}, title.text = title.text || null, title.id = title.text ? title.id || "qrcode-title" : null;
    let size = _this.getModuleCount() * cellSize + margin * 2, c, mc, r, mr, qrSvg = "", rect;
    rect = "l" + cellSize + ",0 0," + cellSize + " -" + cellSize + ",0 0,-" + cellSize + "z ", qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"', qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : "", qrSvg += ' viewBox="0 0 ' + size + " " + size + '" ', qrSvg += ' preserveAspectRatio="xMinYMin meet"', qrSvg += title.text || alt.text ? ' role="img" aria-labelledby="' + escapeXml([title.id, alt.id].join(" ").trim()) + '"' : "", qrSvg += ">", qrSvg += title.text ? '<title id="' + escapeXml(title.id) + '">' + escapeXml(title.text) + "</title>" : "", qrSvg += alt.text ? '<description id="' + escapeXml(alt.id) + '">' + escapeXml(alt.text) + "</description>" : "", qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>', qrSvg += '<path d="';
    for (r = 0;r < _this.getModuleCount(); r += 1) {
      mr = r * cellSize + margin;
      for (c = 0;c < _this.getModuleCount(); c += 1)
        if (_this.isDark(r, c))
          mc = c * cellSize + margin, qrSvg += "M" + mc + "," + mr + rect;
    }
    return qrSvg += '" stroke="transparent" fill="black"/>', qrSvg += "</svg>", qrSvg;
  }, _this.createDataURL = function(cellSize, margin) {
    cellSize = cellSize || 2, margin = typeof margin > "u" ? cellSize * 4 : margin;
    let size = _this.getModuleCount() * cellSize + margin * 2, min = margin, max = size - margin;
    return createDataURL(size, size, function(x, y) {
      if (min <= x && x < max && min <= y && y < max) {
        let c = Math.floor((x - min) / cellSize), r = Math.floor((y - min) / cellSize);
        return _this.isDark(r, c) ? 0 : 1;
      } else
        return 1;
    });
  }, _this.createImgTag = function(cellSize, margin, alt) {
    cellSize = cellSize || 2, margin = typeof margin > "u" ? cellSize * 4 : margin;
    let size = _this.getModuleCount() * cellSize + margin * 2, img = "";
    if (img += "<img", img += ' src="', img += _this.createDataURL(cellSize, margin), img += '"', img += ' width="', img += size, img += '"', img += ' height="', img += size, img += '"', alt)
      img += ' alt="', img += escapeXml(alt), img += '"';
    return img += "/>", img;
  };
  let escapeXml = function(s) {
    let escaped = "";
    for (let i = 0;i < s.length; i += 1) {
      let c = s.charAt(i);
      switch (c) {
        case "<":
          escaped += "&lt;";
          break;
        case ">":
          escaped += "&gt;";
          break;
        case "&":
          escaped += "&amp;";
          break;
        case '"':
          escaped += "&quot;";
          break;
        default:
          escaped += c;
          break;
      }
    }
    return escaped;
  }, _createHalfASCII = function(margin) {
    margin = typeof margin > "u" ? 2 : margin;
    let size = _this.getModuleCount() * 1 + margin * 2, min = margin, max = size - margin, y, x, r1, r2, p, blocks = {
      "██": "█",
      "█ ": "▀",
      " █": "▄",
      "  ": " "
    }, blocksLastLineNoMargin = {
      "██": "▀",
      "█ ": "▀",
      " █": " ",
      "  ": " "
    }, ascii = "";
    for (y = 0;y < size; y += 2) {
      r1 = Math.floor((y - min) / 1), r2 = Math.floor((y + 1 - min) / 1);
      for (x = 0;x < size; x += 1) {
        if (p = "█", min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / 1)))
          p = " ";
        if (min <= x && x < max && min <= y + 1 && y + 1 < max && _this.isDark(r2, Math.floor((x - min) / 1)))
          p += " ";
        else
          p += "█";
        ascii += margin < 1 && y + 1 >= max ? blocksLastLineNoMargin[p] : blocks[p];
      }
      ascii += `
`;
    }
    if (size % 2 && margin > 0)
      return ascii.substring(0, ascii.length - size - 1) + Array(size + 1).join("▀");
    return ascii.substring(0, ascii.length - 1);
  };
  return _this.createASCII = function(cellSize, margin) {
    if (cellSize = cellSize || 1, cellSize < 2)
      return _createHalfASCII(margin);
    cellSize -= 1, margin = typeof margin > "u" ? cellSize * 2 : margin;
    let size = _this.getModuleCount() * cellSize + margin * 2, min = margin, max = size - margin, y, x, r, p, white = Array(cellSize + 1).join("██"), black = Array(cellSize + 1).join("  "), ascii = "", line = "";
    for (y = 0;y < size; y += 1) {
      r = Math.floor((y - min) / cellSize), line = "";
      for (x = 0;x < size; x += 1) {
        if (p = 1, min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize)))
          p = 0;
        line += p ? white : black;
      }
      for (r = 0;r < cellSize; r += 1)
        ascii += line + `
`;
    }
    return ascii.substring(0, ascii.length - 1);
  }, _this.renderTo2dContext = function(context, cellSize) {
    cellSize = cellSize || 2;
    let length = _this.getModuleCount();
    for (let row = 0;row < length; row++)
      for (let col = 0;col < length; col++)
        context.fillStyle = _this.isDark(row, col) ? "black" : "white", context.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
  }, _this;
};
qrcode.stringToBytes = function(s) {
  let bytes = [];
  for (let i = 0;i < s.length; i += 1) {
    let c = s.charCodeAt(i);
    bytes.push(c & 255);
  }
  return bytes;
};
qrcode.createStringToBytes = function(unicodeData, numChars) {
  let unicodeMap = function() {
    let bin = base64DecodeInputStream(unicodeData), read = function() {
      let b = bin.read();
      if (b == -1)
        throw "eof";
      return b;
    }, count = 0, unicodeMap = {};
    while (!0) {
      let b0 = bin.read();
      if (b0 == -1)
        break;
      let b1 = read(), b2 = read(), b3 = read(), k = String.fromCharCode(b0 << 8 | b1), v = b2 << 8 | b3;
      unicodeMap[k] = v, count += 1;
    }
    if (count != numChars)
      throw count + " != " + numChars;
    return unicodeMap;
  }(), unknownChar = 63;
  return function(s) {
    let bytes = [];
    for (let i = 0;i < s.length; i += 1) {
      let c = s.charCodeAt(i);
      if (c < 128)
        bytes.push(c);
      else {
        let b = unicodeMap[s.charAt(i)];
        if (typeof b == "number")
          if ((b & 255) == b)
            bytes.push(b);
          else
            bytes.push(b >>> 8), bytes.push(b & 255);
        else
          bytes.push(63);
      }
    }
    return bytes;
  };
};
var QRMode = {
  MODE_NUMBER: 1,
  MODE_ALPHA_NUM: 2,
  MODE_8BIT_BYTE: 4,
  MODE_KANJI: 8
}, QRErrorCorrectionLevel = {
  L: 1,
  M: 0,
  Q: 3,
  H: 2
}, QRMaskPattern = {
  PATTERN000: 0,
  PATTERN001: 1,
  PATTERN010: 2,
  PATTERN011: 3,
  PATTERN100: 4,
  PATTERN101: 5,
  PATTERN110: 6,
  PATTERN111: 7
}, QRUtil = function() {
  let PATTERN_POSITION_TABLE = [
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],
    [6, 30, 54],
    [6, 32, 58],
    [6, 34, 62],
    [6, 26, 46, 66],
    [6, 26, 48, 70],
    [6, 26, 50, 74],
    [6, 30, 54, 78],
    [6, 30, 56, 82],
    [6, 30, 58, 86],
    [6, 34, 62, 90],
    [6, 28, 50, 72, 94],
    [6, 26, 50, 74, 98],
    [6, 30, 54, 78, 102],
    [6, 28, 54, 80, 106],
    [6, 32, 58, 84, 110],
    [6, 30, 58, 86, 114],
    [6, 34, 62, 90, 118],
    [6, 26, 50, 74, 98, 122],
    [6, 30, 54, 78, 102, 126],
    [6, 26, 52, 78, 104, 130],
    [6, 30, 56, 82, 108, 134],
    [6, 34, 60, 86, 112, 138],
    [6, 30, 58, 86, 114, 142],
    [6, 34, 62, 90, 118, 146],
    [6, 30, 54, 78, 102, 126, 150],
    [6, 24, 50, 76, 102, 128, 154],
    [6, 28, 54, 80, 106, 132, 158],
    [6, 32, 58, 84, 110, 136, 162],
    [6, 26, 54, 82, 110, 138, 166],
    [6, 30, 58, 86, 114, 142, 170]
  ], G15 = 1335, G18 = 7973, G15_MASK = 21522, _this = {}, getBCHDigit = function(data) {
    let digit = 0;
    while (data != 0)
      digit += 1, data >>>= 1;
    return digit;
  };
  return _this.getBCHTypeInfo = function(data) {
    let d = data << 10;
    while (getBCHDigit(d) - getBCHDigit(1335) >= 0)
      d ^= 1335 << getBCHDigit(d) - getBCHDigit(1335);
    return (data << 10 | d) ^ 21522;
  }, _this.getBCHTypeNumber = function(data) {
    let d = data << 12;
    while (getBCHDigit(d) - getBCHDigit(7973) >= 0)
      d ^= 7973 << getBCHDigit(d) - getBCHDigit(7973);
    return data << 12 | d;
  }, _this.getPatternPosition = function(typeNumber) {
    return PATTERN_POSITION_TABLE[typeNumber - 1];
  }, _this.getMaskFunction = function(maskPattern) {
    switch (maskPattern) {
      case QRMaskPattern.PATTERN000:
        return function(i, j) {
          return (i + j) % 2 == 0;
        };
      case QRMaskPattern.PATTERN001:
        return function(i, j) {
          return i % 2 == 0;
        };
      case QRMaskPattern.PATTERN010:
        return function(i, j) {
          return j % 3 == 0;
        };
      case QRMaskPattern.PATTERN011:
        return function(i, j) {
          return (i + j) % 3 == 0;
        };
      case QRMaskPattern.PATTERN100:
        return function(i, j) {
          return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 == 0;
        };
      case QRMaskPattern.PATTERN101:
        return function(i, j) {
          return i * j % 2 + i * j % 3 == 0;
        };
      case QRMaskPattern.PATTERN110:
        return function(i, j) {
          return (i * j % 2 + i * j % 3) % 2 == 0;
        };
      case QRMaskPattern.PATTERN111:
        return function(i, j) {
          return (i * j % 3 + (i + j) % 2) % 2 == 0;
        };
      default:
        throw "bad maskPattern:" + maskPattern;
    }
  }, _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
    let a = qrPolynomial([1], 0);
    for (let i = 0;i < errorCorrectLength; i += 1)
      a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0));
    return a;
  }, _this.getLengthInBits = function(mode, type) {
    if (1 <= type && type < 10)
      switch (mode) {
        case QRMode.MODE_NUMBER:
          return 10;
        case QRMode.MODE_ALPHA_NUM:
          return 9;
        case QRMode.MODE_8BIT_BYTE:
          return 8;
        case QRMode.MODE_KANJI:
          return 8;
        default:
          throw "mode:" + mode;
      }
    else if (type < 27)
      switch (mode) {
        case QRMode.MODE_NUMBER:
          return 12;
        case QRMode.MODE_ALPHA_NUM:
          return 11;
        case QRMode.MODE_8BIT_BYTE:
          return 16;
        case QRMode.MODE_KANJI:
          return 10;
        default:
          throw "mode:" + mode;
      }
    else if (type < 41)
      switch (mode) {
        case QRMode.MODE_NUMBER:
          return 14;
        case QRMode.MODE_ALPHA_NUM:
          return 13;
        case QRMode.MODE_8BIT_BYTE:
          return 16;
        case QRMode.MODE_KANJI:
          return 12;
        default:
          throw "mode:" + mode;
      }
    else
      throw "type:" + type;
  }, _this.getLostPoint = function(qrcode) {
    let moduleCount = qrcode.getModuleCount(), lostPoint = 0;
    for (let row = 0;row < moduleCount; row += 1)
      for (let col = 0;col < moduleCount; col += 1) {
        let sameCount = 0, dark = qrcode.isDark(row, col);
        for (let r = -1;r <= 1; r += 1) {
          if (row + r < 0 || moduleCount <= row + r)
            continue;
          for (let c = -1;c <= 1; c += 1) {
            if (col + c < 0 || moduleCount <= col + c)
              continue;
            if (r == 0 && c == 0)
              continue;
            if (dark == qrcode.isDark(row + r, col + c))
              sameCount += 1;
          }
        }
        if (sameCount > 5)
          lostPoint += 3 + sameCount - 5;
      }
    for (let row = 0;row < moduleCount - 1; row += 1)
      for (let col = 0;col < moduleCount - 1; col += 1) {
        let count = 0;
        if (qrcode.isDark(row, col))
          count += 1;
        if (qrcode.isDark(row + 1, col))
          count += 1;
        if (qrcode.isDark(row, col + 1))
          count += 1;
        if (qrcode.isDark(row + 1, col + 1))
          count += 1;
        if (count == 0 || count == 4)
          lostPoint += 3;
      }
    for (let row = 0;row < moduleCount; row += 1)
      for (let col = 0;col < moduleCount - 6; col += 1)
        if (qrcode.isDark(row, col) && !qrcode.isDark(row, col + 1) && qrcode.isDark(row, col + 2) && qrcode.isDark(row, col + 3) && qrcode.isDark(row, col + 4) && !qrcode.isDark(row, col + 5) && qrcode.isDark(row, col + 6))
          lostPoint += 40;
    for (let col = 0;col < moduleCount; col += 1)
      for (let row = 0;row < moduleCount - 6; row += 1)
        if (qrcode.isDark(row, col) && !qrcode.isDark(row + 1, col) && qrcode.isDark(row + 2, col) && qrcode.isDark(row + 3, col) && qrcode.isDark(row + 4, col) && !qrcode.isDark(row + 5, col) && qrcode.isDark(row + 6, col))
          lostPoint += 40;
    let darkCount = 0;
    for (let col = 0;col < moduleCount; col += 1)
      for (let row = 0;row < moduleCount; row += 1)
        if (qrcode.isDark(row, col))
          darkCount += 1;
    let ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
    return lostPoint += ratio * 10, lostPoint;
  }, _this;
}(), QRMath = function() {
  let EXP_TABLE = Array(256), LOG_TABLE = Array(256);
  for (let i = 0;i < 8; i += 1)
    EXP_TABLE[i] = 1 << i;
  for (let i = 8;i < 256; i += 1)
    EXP_TABLE[i] = EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
  for (let i = 0;i < 255; i += 1)
    LOG_TABLE[EXP_TABLE[i]] = i;
  let _this = {};
  return _this.glog = function(n) {
    if (n < 1)
      throw "glog(" + n + ")";
    return LOG_TABLE[n];
  }, _this.gexp = function(n) {
    while (n < 0)
      n += 255;
    while (n >= 256)
      n -= 255;
    return EXP_TABLE[n];
  }, _this;
}(), qrPolynomial = function(num, shift) {
  if (typeof num.length > "u")
    throw num.length + "/" + shift;
  let _num = function() {
    let offset = 0;
    while (offset < num.length && num[offset] == 0)
      offset += 1;
    let _num = Array(num.length - offset + shift);
    for (let i = 0;i < num.length - offset; i += 1)
      _num[i] = num[i + offset];
    return _num;
  }(), _this = {};
  return _this.getAt = function(index) {
    return _num[index];
  }, _this.getLength = function() {
    return _num.length;
  }, _this.multiply = function(e) {
    let num = Array(_this.getLength() + e.getLength() - 1);
    for (let i = 0;i < _this.getLength(); i += 1)
      for (let j = 0;j < e.getLength(); j += 1)
        num[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i)) + QRMath.glog(e.getAt(j)));
    return qrPolynomial(num, 0);
  }, _this.mod = function(e) {
    if (_this.getLength() - e.getLength() < 0)
      return _this;
    let ratio = QRMath.glog(_this.getAt(0)) - QRMath.glog(e.getAt(0)), num = Array(_this.getLength());
    for (let i = 0;i < _this.getLength(); i += 1)
      num[i] = _this.getAt(i);
    for (let i = 0;i < e.getLength(); i += 1)
      num[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i)) + ratio);
    return qrPolynomial(num, 0).mod(e);
  }, _this;
}, QRRSBlock = function() {
  let RS_BLOCK_TABLE = [
    [1, 26, 19],
    [1, 26, 16],
    [1, 26, 13],
    [1, 26, 9],
    [1, 44, 34],
    [1, 44, 28],
    [1, 44, 22],
    [1, 44, 16],
    [1, 70, 55],
    [1, 70, 44],
    [2, 35, 17],
    [2, 35, 13],
    [1, 100, 80],
    [2, 50, 32],
    [2, 50, 24],
    [4, 25, 9],
    [1, 134, 108],
    [2, 67, 43],
    [2, 33, 15, 2, 34, 16],
    [2, 33, 11, 2, 34, 12],
    [2, 86, 68],
    [4, 43, 27],
    [4, 43, 19],
    [4, 43, 15],
    [2, 98, 78],
    [4, 49, 31],
    [2, 32, 14, 4, 33, 15],
    [4, 39, 13, 1, 40, 14],
    [2, 121, 97],
    [2, 60, 38, 2, 61, 39],
    [4, 40, 18, 2, 41, 19],
    [4, 40, 14, 2, 41, 15],
    [2, 146, 116],
    [3, 58, 36, 2, 59, 37],
    [4, 36, 16, 4, 37, 17],
    [4, 36, 12, 4, 37, 13],
    [2, 86, 68, 2, 87, 69],
    [4, 69, 43, 1, 70, 44],
    [6, 43, 19, 2, 44, 20],
    [6, 43, 15, 2, 44, 16],
    [4, 101, 81],
    [1, 80, 50, 4, 81, 51],
    [4, 50, 22, 4, 51, 23],
    [3, 36, 12, 8, 37, 13],
    [2, 116, 92, 2, 117, 93],
    [6, 58, 36, 2, 59, 37],
    [4, 46, 20, 6, 47, 21],
    [7, 42, 14, 4, 43, 15],
    [4, 133, 107],
    [8, 59, 37, 1, 60, 38],
    [8, 44, 20, 4, 45, 21],
    [12, 33, 11, 4, 34, 12],
    [3, 145, 115, 1, 146, 116],
    [4, 64, 40, 5, 65, 41],
    [11, 36, 16, 5, 37, 17],
    [11, 36, 12, 5, 37, 13],
    [5, 109, 87, 1, 110, 88],
    [5, 65, 41, 5, 66, 42],
    [5, 54, 24, 7, 55, 25],
    [11, 36, 12, 7, 37, 13],
    [5, 122, 98, 1, 123, 99],
    [7, 73, 45, 3, 74, 46],
    [15, 43, 19, 2, 44, 20],
    [3, 45, 15, 13, 46, 16],
    [1, 135, 107, 5, 136, 108],
    [10, 74, 46, 1, 75, 47],
    [1, 50, 22, 15, 51, 23],
    [2, 42, 14, 17, 43, 15],
    [5, 150, 120, 1, 151, 121],
    [9, 69, 43, 4, 70, 44],
    [17, 50, 22, 1, 51, 23],
    [2, 42, 14, 19, 43, 15],
    [3, 141, 113, 4, 142, 114],
    [3, 70, 44, 11, 71, 45],
    [17, 47, 21, 4, 48, 22],
    [9, 39, 13, 16, 40, 14],
    [3, 135, 107, 5, 136, 108],
    [3, 67, 41, 13, 68, 42],
    [15, 54, 24, 5, 55, 25],
    [15, 43, 15, 10, 44, 16],
    [4, 144, 116, 4, 145, 117],
    [17, 68, 42],
    [17, 50, 22, 6, 51, 23],
    [19, 46, 16, 6, 47, 17],
    [2, 139, 111, 7, 140, 112],
    [17, 74, 46],
    [7, 54, 24, 16, 55, 25],
    [34, 37, 13],
    [4, 151, 121, 5, 152, 122],
    [4, 75, 47, 14, 76, 48],
    [11, 54, 24, 14, 55, 25],
    [16, 45, 15, 14, 46, 16],
    [6, 147, 117, 4, 148, 118],
    [6, 73, 45, 14, 74, 46],
    [11, 54, 24, 16, 55, 25],
    [30, 46, 16, 2, 47, 17],
    [8, 132, 106, 4, 133, 107],
    [8, 75, 47, 13, 76, 48],
    [7, 54, 24, 22, 55, 25],
    [22, 45, 15, 13, 46, 16],
    [10, 142, 114, 2, 143, 115],
    [19, 74, 46, 4, 75, 47],
    [28, 50, 22, 6, 51, 23],
    [33, 46, 16, 4, 47, 17],
    [8, 152, 122, 4, 153, 123],
    [22, 73, 45, 3, 74, 46],
    [8, 53, 23, 26, 54, 24],
    [12, 45, 15, 28, 46, 16],
    [3, 147, 117, 10, 148, 118],
    [3, 73, 45, 23, 74, 46],
    [4, 54, 24, 31, 55, 25],
    [11, 45, 15, 31, 46, 16],
    [7, 146, 116, 7, 147, 117],
    [21, 73, 45, 7, 74, 46],
    [1, 53, 23, 37, 54, 24],
    [19, 45, 15, 26, 46, 16],
    [5, 145, 115, 10, 146, 116],
    [19, 75, 47, 10, 76, 48],
    [15, 54, 24, 25, 55, 25],
    [23, 45, 15, 25, 46, 16],
    [13, 145, 115, 3, 146, 116],
    [2, 74, 46, 29, 75, 47],
    [42, 54, 24, 1, 55, 25],
    [23, 45, 15, 28, 46, 16],
    [17, 145, 115],
    [10, 74, 46, 23, 75, 47],
    [10, 54, 24, 35, 55, 25],
    [19, 45, 15, 35, 46, 16],
    [17, 145, 115, 1, 146, 116],
    [14, 74, 46, 21, 75, 47],
    [29, 54, 24, 19, 55, 25],
    [11, 45, 15, 46, 46, 16],
    [13, 145, 115, 6, 146, 116],
    [14, 74, 46, 23, 75, 47],
    [44, 54, 24, 7, 55, 25],
    [59, 46, 16, 1, 47, 17],
    [12, 151, 121, 7, 152, 122],
    [12, 75, 47, 26, 76, 48],
    [39, 54, 24, 14, 55, 25],
    [22, 45, 15, 41, 46, 16],
    [6, 151, 121, 14, 152, 122],
    [6, 75, 47, 34, 76, 48],
    [46, 54, 24, 10, 55, 25],
    [2, 45, 15, 64, 46, 16],
    [17, 152, 122, 4, 153, 123],
    [29, 74, 46, 14, 75, 47],
    [49, 54, 24, 10, 55, 25],
    [24, 45, 15, 46, 46, 16],
    [4, 152, 122, 18, 153, 123],
    [13, 74, 46, 32, 75, 47],
    [48, 54, 24, 14, 55, 25],
    [42, 45, 15, 32, 46, 16],
    [20, 147, 117, 4, 148, 118],
    [40, 75, 47, 7, 76, 48],
    [43, 54, 24, 22, 55, 25],
    [10, 45, 15, 67, 46, 16],
    [19, 148, 118, 6, 149, 119],
    [18, 75, 47, 31, 76, 48],
    [34, 54, 24, 34, 55, 25],
    [20, 45, 15, 61, 46, 16]
  ], qrRSBlock = function(totalCount, dataCount) {
    let _this = {};
    return _this.totalCount = totalCount, _this.dataCount = dataCount, _this;
  }, _this = {}, getRsBlockTable = function(typeNumber, errorCorrectionLevel) {
    switch (errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default:
        return;
    }
  };
  return _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {
    let rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);
    if (typeof rsBlock > "u")
      throw "bad rs block @ typeNumber:" + typeNumber + "/errorCorrectionLevel:" + errorCorrectionLevel;
    let length = rsBlock.length / 3, list = [];
    for (let i = 0;i < length; i += 1) {
      let count = rsBlock[i * 3 + 0], totalCount = rsBlock[i * 3 + 1], dataCount = rsBlock[i * 3 + 2];
      for (let j = 0;j < count; j += 1)
        list.push(qrRSBlock(totalCount, dataCount));
    }
    return list;
  }, _this;
}(), qrBitBuffer = function() {
  let _buffer = [], _length = 0, _this = {};
  return _this.getBuffer = function() {
    return _buffer;
  }, _this.getAt = function(index) {
    let bufIndex = Math.floor(index / 8);
    return (_buffer[bufIndex] >>> 7 - index % 8 & 1) == 1;
  }, _this.put = function(num, length) {
    for (let i = 0;i < length; i += 1)
      _this.putBit((num >>> length - i - 1 & 1) == 1);
  }, _this.getLengthInBits = function() {
    return _length;
  }, _this.putBit = function(bit) {
    let bufIndex = Math.floor(_length / 8);
    if (_buffer.length <= bufIndex)
      _buffer.push(0);
    if (bit)
      _buffer[bufIndex] |= 128 >>> _length % 8;
    _length += 1;
  }, _this;
}, qrNumber = function(data) {
  let _mode = QRMode.MODE_NUMBER, _data = data, _this = {};
  _this.getMode = function() {
    return _mode;
  }, _this.getLength = function(buffer) {
    return _data.length;
  }, _this.write = function(buffer) {
    let data = _data, i = 0;
    while (i + 2 < data.length)
      buffer.put(strToNum(data.substring(i, i + 3)), 10), i += 3;
    if (i < data.length) {
      if (data.length - i == 1)
        buffer.put(strToNum(data.substring(i, i + 1)), 4);
      else if (data.length - i == 2)
        buffer.put(strToNum(data.substring(i, i + 2)), 7);
    }
  };
  let strToNum = function(s) {
    let num = 0;
    for (let i = 0;i < s.length; i += 1)
      num = num * 10 + chatToNum(s.charAt(i));
    return num;
  }, chatToNum = function(c) {
    if ("0" <= c && c <= "9")
      return c.charCodeAt(0) - 48;
    throw "illegal char :" + c;
  };
  return _this;
}, qrAlphaNum = function(data) {
  let _mode = QRMode.MODE_ALPHA_NUM, _data = data, _this = {};
  _this.getMode = function() {
    return _mode;
  }, _this.getLength = function(buffer) {
    return _data.length;
  }, _this.write = function(buffer) {
    let s = _data, i = 0;
    while (i + 1 < s.length)
      buffer.put(getCode(s.charAt(i)) * 45 + getCode(s.charAt(i + 1)), 11), i += 2;
    if (i < s.length)
      buffer.put(getCode(s.charAt(i)), 6);
  };
  let getCode = function(c) {
    if ("0" <= c && c <= "9")
      return c.charCodeAt(0) - 48;
    else if ("A" <= c && c <= "Z")
      return c.charCodeAt(0) - 65 + 10;
    else
      switch (c) {
        case " ":
          return 36;
        case "$":
          return 37;
        case "%":
          return 38;
        case "*":
          return 39;
        case "+":
          return 40;
        case "-":
          return 41;
        case ".":
          return 42;
        case "/":
          return 43;
        case ":":
          return 44;
        default:
          throw "illegal char :" + c;
      }
  };
  return _this;
}, qr8BitByte = function(data) {
  let _mode = QRMode.MODE_8BIT_BYTE, _data = data, _bytes = qrcode.stringToBytes(data), _this = {};
  return _this.getMode = function() {
    return _mode;
  }, _this.getLength = function(buffer) {
    return _bytes.length;
  }, _this.write = function(buffer) {
    for (let i = 0;i < _bytes.length; i += 1)
      buffer.put(_bytes[i], 8);
  }, _this;
}, qrKanji = function(data) {
  let _mode = QRMode.MODE_KANJI, _data = data, stringToBytes = qrcode.stringToBytes;
  (function(c, code) {
    let test = stringToBytes(c);
    if (test.length != 2 || (test[0] << 8 | test[1]) != code)
      throw "sjis not supported.";
  })("友", 38726);
  let _bytes = stringToBytes(data), _this = {};
  return _this.getMode = function() {
    return _mode;
  }, _this.getLength = function(buffer) {
    return ~~(_bytes.length / 2);
  }, _this.write = function(buffer) {
    let data = _bytes, i = 0;
    while (i + 1 < data.length) {
      let c = (255 & data[i]) << 8 | 255 & data[i + 1];
      if (33088 <= c && c <= 40956)
        c -= 33088;
      else if (57408 <= c && c <= 60351)
        c -= 49472;
      else
        throw "illegal char at " + (i + 1) + "/" + c;
      c = (c >>> 8 & 255) * 192 + (c & 255), buffer.put(c, 13), i += 2;
    }
    if (i < data.length)
      throw "illegal char at " + (i + 1);
  }, _this;
}, byteArrayOutputStream = function() {
  let _bytes = [], _this = {};
  return _this.writeByte = function(b) {
    _bytes.push(b & 255);
  }, _this.writeShort = function(i) {
    _this.writeByte(i), _this.writeByte(i >>> 8);
  }, _this.writeBytes = function(b, off, len) {
    off = off || 0, len = len || b.length;
    for (let i = 0;i < len; i += 1)
      _this.writeByte(b[i + off]);
  }, _this.writeString = function(s) {
    for (let i = 0;i < s.length; i += 1)
      _this.writeByte(s.charCodeAt(i));
  }, _this.toByteArray = function() {
    return _bytes;
  }, _this.toString = function() {
    let s = "";
    s += "[";
    for (let i = 0;i < _bytes.length; i += 1) {
      if (i > 0)
        s += ",";
      s += _bytes[i];
    }
    return s += "]", s;
  }, _this;
}, base64EncodeOutputStream = function() {
  let _buffer = 0, _buflen = 0, _length = 0, _base64 = "", _this = {}, writeEncoded = function(b) {
    _base64 += String.fromCharCode(encode(b & 63));
  }, encode = function(n) {
    if (n < 0)
      throw "n:" + n;
    else if (n < 26)
      return 65 + n;
    else if (n < 52)
      return 97 + (n - 26);
    else if (n < 62)
      return 48 + (n - 52);
    else if (n == 62)
      return 43;
    else if (n == 63)
      return 47;
    else
      throw "n:" + n;
  };
  return _this.writeByte = function(n) {
    _buffer = _buffer << 8 | n & 255, _buflen += 8, _length += 1;
    while (_buflen >= 6)
      writeEncoded(_buffer >>> _buflen - 6), _buflen -= 6;
  }, _this.flush = function() {
    if (_buflen > 0)
      writeEncoded(_buffer << 6 - _buflen), _buffer = 0, _buflen = 0;
    if (_length % 3 != 0) {
      let padlen = 3 - _length % 3;
      for (let i = 0;i < padlen; i += 1)
        _base64 += "=";
    }
  }, _this.toString = function() {
    return _base64;
  }, _this;
}, base64DecodeInputStream = function(str) {
  let _str = str, _pos = 0, _buffer = 0, _buflen = 0, _this = {};
  _this.read = function() {
    while (_buflen < 8) {
      if (_pos >= _str.length) {
        if (_buflen == 0)
          return -1;
        throw "unexpected end of file./" + _buflen;
      }
      let c = _str.charAt(_pos);
      if (_pos += 1, c == "=")
        return _buflen = 0, -1;
      else if (c.match(/^\s$/))
        continue;
      _buffer = _buffer << 6 | decode(c.charCodeAt(0)), _buflen += 6;
    }
    let n = _buffer >>> _buflen - 8 & 255;
    return _buflen -= 8, n;
  };
  let decode = function(c) {
    if (65 <= c && c <= 90)
      return c - 65;
    else if (97 <= c && c <= 122)
      return c - 97 + 26;
    else if (48 <= c && c <= 57)
      return c - 48 + 52;
    else if (c == 43)
      return 62;
    else if (c == 47)
      return 63;
    else
      throw "c:" + c;
  };
  return _this;
}, gifImage = function(width, height) {
  let _width = width, _height = height, _data = Array(width * height), _this = {};
  _this.setPixel = function(x, y, pixel) {
    _data[y * _width + x] = pixel;
  }, _this.write = function(out) {
    out.writeString("GIF87a"), out.writeShort(_width), out.writeShort(_height), out.writeByte(128), out.writeByte(0), out.writeByte(0), out.writeByte(0), out.writeByte(0), out.writeByte(0), out.writeByte(255), out.writeByte(255), out.writeByte(255), out.writeString(","), out.writeShort(0), out.writeShort(0), out.writeShort(_width), out.writeShort(_height), out.writeByte(0);
    let lzwMinCodeSize = 2, raster = getLZWRaster(lzwMinCodeSize);
    out.writeByte(lzwMinCodeSize);
    let offset = 0;
    while (raster.length - offset > 255)
      out.writeByte(255), out.writeBytes(raster, offset, 255), offset += 255;
    out.writeByte(raster.length - offset), out.writeBytes(raster, offset, raster.length - offset), out.writeByte(0), out.writeString(";");
  };
  let bitOutputStream = function(out) {
    let _out = out, _bitLength = 0, _bitBuffer = 0, _this = {};
    return _this.write = function(data, length) {
      if (data >>> length != 0)
        throw "length over";
      while (_bitLength + length >= 8)
        _out.writeByte(255 & (data << _bitLength | _bitBuffer)), length -= 8 - _bitLength, data >>>= 8 - _bitLength, _bitBuffer = 0, _bitLength = 0;
      _bitBuffer = data << _bitLength | _bitBuffer, _bitLength = _bitLength + length;
    }, _this.flush = function() {
      if (_bitLength > 0)
        _out.writeByte(_bitBuffer);
    }, _this;
  }, getLZWRaster = function(lzwMinCodeSize) {
    let clearCode = 1 << lzwMinCodeSize, endCode = (1 << lzwMinCodeSize) + 1, bitLength = lzwMinCodeSize + 1, table = lzwTable();
    for (let i = 0;i < clearCode; i += 1)
      table.add(String.fromCharCode(i));
    table.add(String.fromCharCode(clearCode)), table.add(String.fromCharCode(endCode));
    let byteOut = byteArrayOutputStream(), bitOut = bitOutputStream(byteOut);
    bitOut.write(clearCode, bitLength);
    let dataIndex = 0, s = String.fromCharCode(_data[dataIndex]);
    dataIndex += 1;
    while (dataIndex < _data.length) {
      let c = String.fromCharCode(_data[dataIndex]);
      if (dataIndex += 1, table.contains(s + c))
        s = s + c;
      else {
        if (bitOut.write(table.indexOf(s), bitLength), table.size() < 4095) {
          if (table.size() == 1 << bitLength)
            bitLength += 1;
          table.add(s + c);
        }
        s = c;
      }
    }
    return bitOut.write(table.indexOf(s), bitLength), bitOut.write(endCode, bitLength), bitOut.flush(), byteOut.toByteArray();
  }, lzwTable = function() {
    let _map = {}, _size = 0, _this = {};
    return _this.add = function(key) {
      if (_this.contains(key))
        throw "dup key:" + key;
      _map[key] = _size, _size += 1;
    }, _this.size = function() {
      return _size;
    }, _this.indexOf = function(key) {
      return _map[key];
    }, _this.contains = function(key) {
      return typeof _map[key] < "u";
    }, _this;
  };
  return _this;
}, createDataURL = function(width, height, getPixel) {
  let gif = gifImage(width, height);
  for (let y = 0;y < height; y += 1)
    for (let x = 0;x < width; x += 1)
      gif.setPixel(x, y, getPixel(x, y));
  let b = byteArrayOutputStream();
  gif.write(b);
  let base64 = base64EncodeOutputStream(), bytes = b.toByteArray();
  for (let i = 0;i < bytes.length; i += 1)
    base64.writeByte(bytes[i]);
  return base64.flush(), "data:image/gif;base64," + base64;
}, qrcode_default = qrcode, stringToBytes = qrcode.stringToBytes;

// engine/site.ts
var OUT = "_site", KEEP_IN_FDROID = Number(env.RELEVANCE_FDROID_KEEP || 3);
function pagesUrl(cfg) {
  if (cfg.settings.store?.domain)
    return `https://${cfg.settings.store.domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  let [owner, repo] = REPO.split("/");
  if (repo.toLowerCase() === `${owner.toLowerCase()}.github.io`)
    return `https://${repo.toLowerCase()}`;
  return `https://${owner.toLowerCase()}.github.io/${repo}`;
}
var esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function qrSvg(text) {
  let q = qrcode_default(0, "M");
  return q.addData(text), q.make(), q.createSvgTag({ cellSize: 4, margin: 0, scalable: !0 });
}
function sanitizeHtml(html) {
  return html.replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "").replace(/\son\w+="[^"]*"/gi, "").replace(/javascript:/gi, "").replace(/<(?!\/?(p|br|b|strong|i|em|s|code|a|ul|ol|li|blockquote|h3|h4)\b)[^>]+>/gi, "");
}
function htmlToFdroid(html) {
  return sanitizeHtml(html).replace(/<\/?(h3|h4)>/g, (t) => t.startsWith("</") ? "</b></p>" : "<p><b>").replace(/<s>|<\/s>|<\/?code>/g, "");
}
function displayName(app) {
  return app.customize?.name || app.name;
}
function finalPackage(app, st) {
  return app.customize?.packageName || st.current?.apk.split("_")[0] || app.packageName;
}
async function buildSite() {
  let cfg = loadConfig(), url = pagesUrl(cfg);
  rmSync2(OUT, { recursive: !0, force: !0 }), mkdirSync5(`${OUT}/assets`, { recursive: !0 });
  let fd = "fdroid-work";
  rmSync2(fd, { recursive: !0, force: !0 }), mkdirSync5(`${fd}/repo`, { recursive: !0 }), mkdirSync5(`${fd}/metadata`, { recursive: !0 });
  let apps = cfg.apps.map((a) => ({ app: a, st: loadState(a.id) })).filter(({ st }) => st.releases?.length);
  info(`Generating store for ${apps.length} published app(s) → ${url}`);
  for (let { app, st } of apps) {
    let pkg = finalPackage(app, st);
    for (let r of st.releases.slice(0, KEEP_IN_FDROID))
      try {
        await download(r.url, `${fd}/repo/${r.apk}`, REPO && env.GITHUB_TOKEN ? {} : {});
      } catch (e) {
        warn(`Skipping ${r.apk}: ${e.message}`);
      }
    let desc = (cfg.settings.notifications?.fdroid && st.attention ? `<p><b>⚠ ${esc(st.attention.kind === "build-failed" ? "An update is available but the build is failing — check it out in Relevance." : st.attention.kind === "signature-changed" ? "An update was held back: the downloaded app isn't signed by its usual developer key." : "An update changed what you picked — review it in Relevance.")}</b></p>` : "") + htmlToFdroid(app.listing?.description || `<p>${esc(app.listing?.summary || app.name)}</p>`), patches = st.current?.patches?.length ? `<p><b>Patches applied</b></p><ul>${st.current.patches.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : "", yml = [
      "Categories:",
      `  - ${JSON.stringify(app.listing?.category || "System")}`,
      "License: Unknown",
      `Name: ${JSON.stringify(displayName(app))}`,
      `Summary: ${JSON.stringify((app.listing?.summary || displayName(app)).slice(0, 80))}`,
      `Description: ${JSON.stringify(desc + patches)}`,
      ...app.listing?.website ? [`WebSite: ${JSON.stringify(app.listing.website)}`] : [],
      `AuthorName: ${JSON.stringify(REPO.split("/")[0])}`,
      `AutoName: ${JSON.stringify(displayName(app))}`,
      ""
    ].join(`
`);
    writeFileSync4(`${fd}/metadata/${pkg}.yml`, yml);
    let loc = `${fd}/metadata/${pkg}/en-US`;
    mkdirSync5(`${loc}/phoneScreenshots`, { recursive: !0 }), await assetTo(app.customize?.icon?.path || app.iconUrl || companionIcon(app), `${loc}/icon.png`);
    let i = 1;
    for (let s of app.listing?.screenshots || [])
      await assetTo(s, `${loc}/phoneScreenshots/${i++}.png`);
  }
  let ksB64 = env.RELEVANCE_KEYSTORE;
  if (ksB64) {
    writeFileSync4(`${fd}/keystore.p12`, Buffer.from(ksB64, "base64"));
    let title = cfg.settings.store?.title || `${REPO.split("/")[0]}'s apps`;
    if (await assetTo(`${cfg.settings.relevanceUrl}/icon-512.png`, `${fd}/repo/icons/icon.png`))
      copyFileSync2(`${fd}/repo/icons/icon.png`, `${fd}/icon.png`);
    else
      warn("Could not download the repository icon");
    writeFileSync4(`${fd}/config.yml`, [
      `repo_url: ${url}/fdroid/repo`,
      `repo_name: ${JSON.stringify(title)}`,
      "repo_icon: icon.png",
      `repo_description: ${JSON.stringify(cfg.settings.store?.description || "Apps built with Relevance.")}`,
      "archive_older: 0",
      "keystore: keystore.p12",
      `keystorepass: ${JSON.stringify(env.RELEVANCE_KEYSTORE_PASSWORD || "")}`,
      `keypass: ${JSON.stringify(env.RELEVANCE_KEYSTORE_PASSWORD || "")}`,
      `repo_keyalias: ${JSON.stringify(cfg.settings.signing?.alias || env.RELEVANCE_KEY_ALIAS || "relevance")}`,
      'keydname: "CN=Relevance"',
      "make_current_version_link: false",
      ""
    ].join(`
`));
    try {
      await run("fdroid", ["update", "--pretty", "--use-date-from-apk", "--create-metadata"], { cwd: fd }), rmSync2(`${fd}/keystore.p12`), mkdirSync5(`${OUT}/fdroid`, { recursive: !0 }), await run("cp", ["-r", `${fd}/repo`, `${OUT}/fdroid/repo`], { quiet: !0 }), ok("F-Droid repository index signed and generated");
    } catch (e) {
      warn(`F-Droid index generation failed: ${e.message}`);
    }
  } else
    warn("No signing key available — skipping the F-Droid repository");
  await assetTo(`${cfg.settings.relevanceUrl}/art/storefront.webp`, `${OUT}/assets/storefront.webp`), await assetTo(`${cfg.settings.relevanceUrl}/icon-512.png`, `${OUT}/assets/icon.png`), writeFileSync4(`${OUT}/assets/style.css`, STYLE), writeFileSync4(`${OUT}/assets/site.js`, SCRIPT);
  let fdroidUrl = `${url}/fdroid/repo`, fingerprint = cfg.settings.signing?.fingerprint?.replace(/[^0-9A-Fa-f]/g, "").toUpperCase(), fdroidAdd = fingerprint ? `${fdroidUrl}?fingerprint=${fingerprint}` : fdroidUrl, cards = [];
  for (let { app, st } of apps) {
    let dir = `${OUT}/apps/${app.id}`;
    mkdirSync5(`${dir}/shots`, { recursive: !0 });
    let icon = await assetTo(app.customize?.icon?.path || app.iconUrl || companionIcon(app), `${dir}/icon.png`) ? "icon.png" : "../../assets/icon.png", shots = [], i = 1;
    for (let s of app.listing?.screenshots || []) {
      let bare = s.replace(/[?#].*$/, ""), ext = /\.(jpe?g)$/i.test(bare) ? "jpg" : /\.webp$/i.test(bare) ? "webp" : "png";
      if (await assetTo(s, `${dir}/shots/${i}.${ext}`))
        shots.push(`shots/${i}.${ext}`);
      i++;
    }
    let ps = [...BUILTIN_SOURCES, ...cfg.patchSources].find((s) => s.id === app.patchSourceId || s.builtin && s.tool === app.tool), recipe = encodeRecipe(recipeFromApp(app, ps ? { tool: ps.tool, name: ps.name, url: ps.url } : void 0));
    writeFileSync4(`${dir}/index.html`, appPage(cfg, app, st, { icon, shots, url, fdroidAdd, recipe })), cards.push(appCard(app, st, `apps/${app.id}/`, `apps/${app.id}/${icon === "icon.png" ? "icon.png" : "../../assets/icon.png"}`));
  }
  writeFileSync4(`${OUT}/index.html`, indexPage(cfg, cards, { url, fdroidAdd })), writeFileSync4(`${OUT}/404.html`, indexPage(cfg, cards, { url, fdroidAdd })), writeFileSync4(`${OUT}/.nojekyll`, ""), writeFileSync4(`${OUT}/qr.svg`, qrSvg(fdroidAdd)), log(`Store site: ${url}`);
  let total = dirSize(OUT);
  ok(`Site generated (${formatBytes(total)})`);
}
function dirSize(d) {
  let n = 0;
  for (let f of readdirSync3(d, { withFileTypes: !0 })) {
    let p = join3(d, f.name);
    n += f.isDirectory() ? dirSize(p) : statSync2(p).size;
  }
  return n;
}
async function assetTo(src, dest) {
  if (!src)
    return !1;
  try {
    if (mkdirSync5(join3(dest, ".."), { recursive: !0 }), /^https?:/.test(src))
      await download(src, dest);
    else if (existsSync5(src))
      copyFileSync2(src, dest);
    else
      return !1;
    return !0;
  } catch {
    return !1;
  }
}
function shell(cfg, title, body, depth, extraHead = "") {
  let base = depth ? "../".repeat(depth) : "./";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="color-scheme" content="light dark">
<meta name="generator" content="Relevance">
<link rel="icon" href="${base}assets/icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${base}assets/style.css">
${extraHead}
</head>
<body>
<header class="top">
  <a class="brand" href="${base}"><img src="${base}assets/icon.png" alt="" width="32" height="32"><span>${esc(cfg.settings.store?.title || "My apps")}</span></a>
  <a class="btn tonal sm" href="#fdroid" data-scroll>${ICON.download} Add to F-Droid</a>
</header>
${body}
<footer class="foot">
  <a href="${esc(cfg.settings.relevanceUrl)}" class="relevance-link">${ICON.external} Customize it further on Relevance</a>
  <p>Built with Relevance. All apps are built and published by the owner of this repository, who is responsible for them.</p>
</footer>
<script src="${base}assets/site.js" defer></script>
</body>
</html>`;
}
function fdroidCard(fdroidAdd, depth) {
  let base = depth ? "../".repeat(depth) : "./";
  return `<section class="card fdroid reveal" id="fdroid">
  <div>
    <h2>F-Droid repository</h2>
    <p>Add this repository in F-Droid to install and receive updates automatically.</p>
    <div class="copy-row"><code title="${esc(fdroidAdd)}">${esc(fdroidAdd)}</code><button class="icon-btn" data-copy="${esc(fdroidAdd)}" aria-label="Copy">${ICON.copy}</button></div>
    <a class="btn filled" href="fdroidrepos://${esc(fdroidAdd.replace(/^https?:\/\//, ""))}">${ICON.download} Open in F-Droid</a>
  </div>
  <img class="qr" src="${base}qr.svg" alt="QR code for the F-Droid repository" width="132" height="132">
</section>`;
}
function appCard(app, st, href, icon) {
  return `<a class="app-card reveal" href="${href}">
  <img class="tile" src="${icon}" alt="" width="64" height="64" loading="lazy">
  <div><h3>${esc(displayName(app))}</h3><p class="mono">${esc(finalPackage(app, st))}</p><p class="mono muted">v${esc(st.current?.version)}</p>
  <p class="sum">${esc(app.listing?.summary || "")}</p></div>
</a>`;
}
function indexPage(cfg, cards, o) {
  let body = `<main class="wrap">
<section class="hero">
  <div class="hero-text">
    <h1>${esc(cfg.settings.store?.title || "My apps")}</h1>
    <p>${esc(cfg.settings.store?.description || "A small, honest collection of apps — kept up to date automatically.")}</p>
  </div>
  <img class="art" src="assets/storefront.webp" alt="" aria-hidden="true">
</section>
<section class="grid">${cards.join(`
`) || '<p class="muted">No apps published yet.</p>'}</section>
${fdroidCard(o.fdroidAdd, 0)}
</main>`;
  return shell(cfg, cfg.settings.store?.title || "My apps", body, 0);
}
function appPage(cfg, app, st, o) {
  let cur = st.current, versions = st.releases.map((r) => `<tr><td class="mono">${esc(r.version)}</td><td class="mono">${esc(r.date.slice(0, 10))}</td><td class="mono">${formatBytes(r.size)}</td><td><a class="icon-btn" href="${esc(r.url)}" aria-label="Download ${esc(r.version)}">${ICON.download}</a></td></tr>`).join(""), warning = cfg.settings.notifications?.fdroid && st.attention ? `<div class="notice">${ICON.warn}<span>${esc(st.attention.kind === "build-failed" ? "An update is available but the build is currently failing. The version below is the last good build." : st.attention.kind === "signature-changed" ? "An update was held back because the downloaded app isn't signed by its usual developer key. The version below is the last good build." : "An update changed the patch selection; the owner is reviewing it.")}</span></div>` : "", body = `<main class="wrap">
<section class="app-hero">
  <img class="tile big" src="${o.icon}" alt="" width="128" height="128">
  <div class="meta">
    <h1>${esc(displayName(app))}</h1>
    <p class="mono">package: ${esc(finalPackage(app, st))}</p>
    <p class="mono">latest: ${esc(cur.version)}</p>
    <div class="actions">
      <a class="btn filled" href="${esc(cur.url)}">${ICON.download} Download APK</a>
      <button class="btn outlined" data-share="${esc(`${o.url}/apps/${app.id}/`)}" data-title="${esc(displayName(app))}">${ICON.share} Share</button>
      <a class="btn outlined" href="${esc(cfg.settings.relevanceUrl)}/recipe#${o.recipe}">${ICON.flask} Use this recipe</a>
    </div>
  </div>
  <img class="art" src="../../assets/storefront.webp" alt="" aria-hidden="true">
</section>
${warning}
${o.shots.length ? `<section class="shots">${o.shots.map((s) => `<button class="shot" data-zoom="${s}"><img src="${s}" alt="Screenshot" loading="lazy"></button>`).join("")}</section>` : ""}
<section class="two">
  <article class="card reveal"><h2>Description</h2><div class="desc">${sanitizeHtml(app.listing?.description || `<p>${esc(app.listing?.summary || "")}</p>`)}</div></article>
  <article class="card reveal"><h2>Patches applied</h2>${cur.patches.length ? `<ul class="checks">${cur.patches.map((p) => `<li>${ICON.check}<span>${esc(p)}</span></li>`).join("")}</ul>` : `<p class="muted">${app.customize?.name || app.customize?.icon || app.customize?.packageName ? "Basic modifications only (name, icon or package)." : "Unmodified — passed on exactly as released."}</p>`}</article>
</section>
<section class="two">
  <article class="card reveal"><h2>Versions</h2><table class="versions"><thead><tr><th>Version</th><th>Date</th><th>Size</th><th></th></tr></thead><tbody>${versions}</tbody></table></article>
  ${fdroidCard(o.fdroidAdd, 2)}
</section>
</main>
<dialog id="zoom"><img alt=""></dialog>`;
  return shell(cfg, `${displayName(app)} · ${cfg.settings.store?.title || "My apps"}`, body, 2);
}
var ICON = {
  download: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 15.6 7.4 11l1.4-1.4 2.2 2.2V4h2v7.8l2.2-2.2 1.4 1.4zM6 20q-.8 0-1.4-.6T4 18v-3h2v3h12v-3h2v3q0 .8-.6 1.4T18 20z"/></svg>',
  share: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M17 22q-1.2 0-2.1-.9T14 19l.1-.7-7-4.1q-.4.4-.9.6T5 15q-1.2 0-2.1-.9T2 12t.9-2.1T5 9q.6 0 1.2.2t.9.6l7-4.1L14 5q0-1.2.9-2.1T17 2t2.1.9T20 5t-.9 2.1T17 8q-.6 0-1.2-.2t-.9-.6l-7 4.1.1.7-.1.7 7 4.1q.4-.4.9-.6T17 16q1.2 0 2.1.9T20 19t-.9 2.1T17 22"/></svg>',
  flask: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M5 21q-1.3 0-1.8-1.1t.2-2.1L9 10V5H8V3h8v2h-1v5l5.6 7.8q.7 1 .2 2.1T19 21zm2-3h10l-3.4-5H10.4z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M9 18q-.8 0-1.4-.6T7 16V4q0-.8.6-1.4T9 2h9q.8 0 1.4.6T20 4v12q0 .8-.6 1.4T18 18zm0-2h9V4H9zm-4 6q-.8 0-1.4-.6T3 20V6h2v14h11v2z"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path fill="#fff" d="m10.6 16.2 7-7-1.4-1.4-5.6 5.6-2.8-2.8-1.4 1.4z"/></svg>',
  external: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M5 21q-.8 0-1.4-.6T3 19V5q0-.8.6-1.4T5 3h7v2H5v14h14v-7h2v7q0 .8-.6 1.4T19 21zm4.7-5.3-1.4-1.4L17.6 5H14V3h7v7h-2V6.4z"/></svg>',
  warn: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M1 21 12 2l11 19zm11-3q.4 0 .7-.3t.3-.7-.3-.7-.7-.3-.7.3-.3.7.3.7.7.3m-1-3h2v-5h-2z"/></svg>'
}, STYLE = `
:root{--bg:#f6eee3;--surface:#fbf6ef;--container:#f1e6d7;--sand:#e8d9c4;--text:#3a2a1f;--muted:#7a6858;--olive:#5f6b2e;--olive-c:#dfe4bb;--terra:#c0664a;--terra-c:#f6d8cb;--outline:#dccdb9;--warn:#fbe7bf;--shadow:0 1px 2px rgba(80,50,20,.06),0 6px 24px rgba(80,50,20,.08)}
@media (prefers-color-scheme:dark){:root{--bg:#1d1814;--surface:#26201a;--container:#2f2820;--sand:#3a3128;--text:#f2e8db;--muted:#bba893;--olive:#c7d08f;--olive-c:#434a20;--terra:#eb9a80;--terra-c:#5a2e21;--outline:#4a3f33;--warn:#4f3d18;--shadow:0 1px 2px rgba(0,0,0,.3),0 8px 28px rgba(0,0,0,.35)}.art{filter:saturate(.8) brightness(.8)}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
html,body{overflow-x:hidden}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 Roboto,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}.mono,code{font-family:"Roboto Mono",ui-monospace,monospace;font-size:.86em}.muted{color:var(--muted)}
.top{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;padding:14px clamp(16px,4vw,40px);background:color-mix(in srgb,var(--bg) 82%,transparent);backdrop-filter:blur(12px)}
.brand{display:flex;gap:10px;align-items:center;text-decoration:none;font-weight:800;font-size:1.25rem}.brand img{border-radius:9px}
.wrap{max-width:1120px;margin:0 auto;padding:0 clamp(16px,4vw,40px) 40px}
.hero,.app-hero{position:relative;display:flex;gap:28px;align-items:center;min-height:260px;padding:24px 0}
.hero-text{position:relative;z-index:1;max-width:520px}
h1{font-size:clamp(2.2rem,5vw,3.4rem);line-height:1.05;margin:0 0 10px;font-weight:900;letter-spacing:-.02em}
h2{margin:0 0 12px;font-size:1.3rem;font-weight:800}
.art{position:absolute;right:-20px;top:0;height:100%;max-width:62%;object-fit:contain;opacity:.95;-webkit-mask-image:radial-gradient(ellipse 70% 70% at 60% 50%,#000 55%,transparent 100%);mask-image:radial-gradient(ellipse 70% 70% at 60% 50%,#000 55%,transparent 100%);z-index:0;pointer-events:none;animation:drift 18s ease-in-out infinite alternate}
@keyframes drift{to{transform:translate3d(-10px,4px,0) scale(1.02)}}
.app-hero .meta{position:relative;z-index:1}.app-hero p{margin:2px 0;color:var(--muted)}
.tile{border-radius:22%;box-shadow:var(--shadow);background:var(--surface);object-fit:cover}.tile.big{width:128px;height:128px;position:relative;z-index:1;animation:pop .6s cubic-bezier(.2,1.4,.4,1) both}
@keyframes pop{from{transform:scale(.6);opacity:0}}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
.btn{display:inline-flex;align-items:center;gap:8px;border:0;border-radius:999px;padding:11px 20px;font:500 .95rem Roboto,sans-serif;text-decoration:none;cursor:pointer;transition:transform .2s cubic-bezier(.2,.9,.3,1.3),box-shadow .2s,background .2s;position:relative;overflow:hidden}
.btn:hover{transform:translateY(-2px);box-shadow:var(--shadow)}.btn:active{transform:scale(.96)}
.btn.filled{background:var(--olive);color:var(--bg)}.btn.outlined{background:var(--surface);color:var(--text);box-shadow:inset 0 0 0 1px var(--outline)}.btn.tonal{background:var(--terra);color:#fff}.btn.sm{padding:8px 16px;font-size:.85rem}
.icon-btn{display:inline-grid;place-items:center;width:36px;height:36px;border-radius:50%;border:0;background:transparent;color:var(--muted);cursor:pointer;transition:background .2s,color .2s,transform .2s}.icon-btn:hover{background:var(--container);color:var(--text);transform:scale(1.08)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px;margin:12px 0 28px}
.app-card{display:flex;gap:14px;padding:18px;border-radius:24px;background:var(--surface);box-shadow:var(--shadow);text-decoration:none;transition:transform .35s cubic-bezier(.2,.9,.3,1.2),box-shadow .35s}.app-card:hover{transform:translateY(-4px) rotate(-.3deg)}
.app-card>div{min-width:0}.app-card .mono{overflow-wrap:anywhere}.app-hero .meta{min-width:0}.app-hero .mono{overflow-wrap:anywhere}.app-card h3{margin:0;font-size:1.1rem}.app-card p{margin:2px 0}.app-card .sum{font-size:.9rem;color:var(--muted);margin-top:6px}
.card{background:var(--surface);border-radius:24px;padding:22px;box-shadow:var(--shadow)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:18px 0}@media(max-width:760px){.fdroid{flex-direction:column;align-items:stretch}.fdroid .qr{align-self:center}.two{grid-template-columns:1fr}.art{opacity:.35;max-width:100%}.app-hero{flex-direction:column;align-items:flex-start}}
.shots{display:flex;gap:14px;overflow-x:auto;padding:10px 2px 18px;scroll-snap-type:x mandatory}
.shot{flex:0 0 auto;border:0;padding:0;background:none;cursor:zoom-in;scroll-snap-align:start;border-radius:18px;overflow:hidden;box-shadow:var(--shadow);transition:transform .3s}.shot:hover{transform:translateY(-4px)}.shot img{display:block;height:340px;width:auto}
.checks{list-style:none;padding:0;margin:0}.checks li{display:flex;gap:10px;align-items:center;padding:6px 0;color:var(--text)}.checks svg{color:var(--olive);flex:0 0 auto}
.versions{width:100%;border-collapse:collapse}.versions th{font-weight:500;color:var(--muted);text-align:left;font-size:.85rem;padding:6px}.versions td{padding:6px;border-top:1px solid var(--outline)}.versions tr{transition:background .2s}.versions tbody tr:hover{background:var(--container)}
.fdroid{display:flex;gap:20px;justify-content:space-between;align-items:center;margin:18px 0}.fdroid .qr{background:#fff;padding:10px;border-radius:14px;flex:0 0 auto}
.copy-row{display:flex;align-items:center;gap:6px;background:var(--container);border-radius:12px;padding:4px 4px 4px 12px;margin:10px 0 14px;overflow:hidden}.copy-row code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.notice{display:flex;gap:10px;align-items:center;background:var(--warn);border-radius:16px;padding:12px 16px;margin:6px 0 10px}
.foot{text-align:center;padding:30px 16px 50px;color:var(--muted);font-size:.85rem}.relevance-link{display:inline-flex;gap:6px;align-items:center;color:var(--terra);font-weight:500;font-size:1rem}
.desc p{margin:.4em 0}
dialog#zoom{border:0;padding:0;background:transparent;max-width:92vw;max-height:92vh}dialog#zoom::backdrop{background:rgba(30,20,10,.6);backdrop-filter:blur(4px)}dialog#zoom img{max-height:90vh;max-width:90vw;border-radius:18px}
.reveal{opacity:0;transform:translateY(18px);transition:opacity .7s ease,transform .7s cubic-bezier(.2,.8,.2,1)}.reveal.in{opacity:1;transform:none}
.toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,40px);opacity:0;background:var(--text);color:var(--bg);padding:10px 18px;border-radius:12px;transition:.35s cubic-bezier(.2,.9,.3,1.2)}.toast.show{transform:translate(-50%,0);opacity:1}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}.reveal{opacity:1;transform:none}}
`, SCRIPT = `
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{threshold:.08});
document.querySelectorAll('.reveal').forEach((el,i)=>{el.style.transitionDelay=(i%6)*60+'ms';io.observe(el)});
function toast(t){const d=document.createElement('div');d.className='toast';d.textContent=t;document.body.append(d);requestAnimationFrame(()=>d.classList.add('show'));setTimeout(()=>{d.classList.remove('show');setTimeout(()=>d.remove(),400)},1800)}
document.addEventListener('click',async e=>{const c=e.target.closest('[data-copy]');if(c){await navigator.clipboard.writeText(c.dataset.copy);toast('Copied')}
const s=e.target.closest('[data-share]');if(s){const url=s.dataset.share;if(navigator.share){try{await navigator.share({title:s.dataset.title,url})}catch{}}else{await navigator.clipboard.writeText(url);toast('Link copied')}}
const z=e.target.closest('[data-zoom]');if(z){const d=document.getElementById('zoom');d.querySelector('img').src=z.dataset.zoom;d.showModal()}
if(e.target.id==='zoom')e.target.close()});
`;

// engine/main.ts
var argv = process.argv.slice(2), cmd = argv[0], arg = (k, d = "") => {
  let i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] ?? "" : d;
}, flag = (k) => argv.includes(`--${k}`) && !["false", "0"].includes(arg(k, "true"));
async function main() {
  let relevanceUrl = process.env.RELEVANCE_URL;
  try {
    relevanceUrl ||= loadConfig().settings.relevanceUrl;
  } catch {}
  setRelay(relevanceUrl), setStep(cmd);
  let app = arg("app");
  log(`Relevance engine ${ENGINE_VERSION} · ${cmd}${app ? ` · ${app}` : ""}`), stepStatus("running");
  try {
    switch (cmd) {
      case "plan":
        await plan(app, { force: flag("force"), trigger: arg("trigger", "manual") || "manual" });
        break;
      case "fetch":
        await fetchApk(app);
        break;
      case "patch":
        await patch(app);
        break;
      case "customize":
        await customize(app);
        break;
      case "sign":
        await sign(app);
        break;
      case "publish":
        await publish(app), await resolveIssues(loadConfig().apps.find((a) => a.id === app));
        break;
      case "skipped":
        await finishSkipped(app);
        break;
      case "fail":
        await fail(app, { cancelled: arg("status") === "cancelled" });
        break;
      case "site":
        await buildSite();
        break;
      case "check":
        await checkUpdates(app || void 0);
        break;
      case "index":
        if (flag("builtin"))
          await indexBuiltin(arg("out", "index"));
        else
          await indexCustomSources();
        break;
      default:
        throw Error(`Unknown command ${cmd}`);
    }
    stepStatus("success"), await flush();
  } catch (e) {
    if (cmd !== "fail")
      recordError(cmd, e);
    if (log(`✗ ${e?.message || e}`), e?.stack)
      process.stdout.write(e.stack + `
`);
    stepStatus("failure", String(e?.message || e).slice(0, 200)), await flush(), process.exitCode = 1;
  }
}
process.on("unhandledRejection", (e) => warn(String(e)));
main();
