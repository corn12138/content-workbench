import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = join(root, "third-party");
const cachedLicenses = new Map();
try {
  const previous = JSON.parse(await readFile(join(output, "inventory.json"), "utf8"));
  for (const pkg of previous.filter((pkg) => pkg.licenseSource)) {
    for (const name of await readdir(join(output, pkg.licenseDirectory))) {
      if (licenseFile(name)) cachedLicenses.set(pkg.licenseSource, await readFile(join(output, pkg.licenseDirectory, name), "utf8"));
    }
  }
} catch (error) { if (error.code !== "ENOENT") throw error; }
function licenseFile(name) { return /^(licen[sc]e|copying|copyright|notice|unlicense)([._-]|$)/i.test(name); }
await rm(output, { recursive: true, force: true });
await mkdir(join(output, "licenses"), { recursive: true });
await mkdir(join(output, "sources"), { recursive: true });
const metadata = JSON.parse(execFileSync("cargo", ["metadata", "--locked", "--format-version", "1", "--filter-platform", "aarch64-apple-darwin", "--manifest-path", "src-tauri/Cargo.toml"], { cwd: root, maxBuffer: 20_000_000 }));
const resolved = new Set(metadata.resolve.nodes.map((node) => node.id));
const inventory = [];
const missing = [];
const licenseName = /^(licen[sc]e|copying|copyright|notice|unlicense)([._-]|$)/i;

async function fetchText(url) {
  // Exact upstream revision URLs let unchanged dependency notices regenerate offline.
  if (cachedLicenses.has(url)) return cachedLicenses.get(url);
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`License fetch failed: ${response.status} ${url}`);
  return response.text();
}

async function collect(ecosystem, name, version, expression, directory, extra = {}) {
  const id = `${ecosystem}-${name.replaceAll("/", "-").replaceAll("@", "")}-${version}`;
  const destination = join(output, "licenses", id);
  await mkdir(destination, { recursive: true });
  const entries = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && licenseName.test(entry.name));
  for (const entry of entries) await copyFile(join(directory, entry.name), join(destination, entry.name));
  if (!entries.length && ecosystem === "cargo") {
    // Some crates omit their workspace license; retrieve it at the crate's recorded source revision.
    const vcs = JSON.parse(await readFile(join(directory, ".cargo_vcs_info.json"), "utf8"));
    const repo = extra.repository?.replace(/\.git$/, "");
    let file;
    if (repo === "https://github.com/madsmtm/objc2") file = "LICENSE.md";
    if (repo === "https://github.com/dropbox/rust-alloc-no-stdlib") file = "LICENSE";
    if (repo === "https://github.com/tauri-apps/tauri") file = "LICENSE-MIT";
    if (file) {
      extra.licenseSource = `${repo.replace("https://github.com/", "https://raw.githubusercontent.com/")}/${vcs.git.sha1}/${file}`;
      await writeFile(join(destination, file), await fetchText(extra.licenseSource));
      entries.push({ name: file });
    } else if (expression === "MPL-2.0") {
      extra.licenseSource = "https://www.mozilla.org/media/MPL/2.0/index.txt";
      const mpl = metadata.packages.find((pkg) => pkg.name === "cssparser" && resolved.has(pkg.id));
      await copyFile(join(dirname(mpl.manifest_path), "LICENSE"), join(destination, "LICENSE"));
      entries.push({ name: "LICENSE" });
    }
  }
  if (!entries.length) missing.push(`${name}@${version}`);
  inventory.push({ ecosystem, name, version, license: expression, ...extra, licenseDirectory: `licenses/${id}` });
}

for (const pkg of metadata.packages.filter((pkg) => pkg.source && resolved.has(pkg.id))) {
  const directory = dirname(pkg.manifest_path);
  const source = `https://crates.io/api/v1/crates/${pkg.name}/${pkg.version}/download`;
  await collect("cargo", pkg.name, pkg.version, pkg.license, directory, { source, repository: pkg.repository });
  if (pkg.license.includes("MPL-2.0")) {
    // Bundle the exact unmodified source for MPL components alongside their notices.
    const registry = dirname(directory);
    const cache = registry.replace(/[/\\]src[/\\]/, "/cache/");
    await copyFile(join(cache, `${pkg.name}-${pkg.version}.crate`), join(output, "sources", `${pkg.name}-${pkg.version}.crate`));
  }
}

const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
for (const [path, pkg] of Object.entries(lock.packages)) {
  if (!path || pkg.dev) continue;
  const directory = join(root, path);
  let manifest;
  try { manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")); }
  catch (error) { if (error.code === "ENOENT" && pkg.optional) continue; throw error; }
  await collect("npm", manifest.name, manifest.version, pkg.license, directory, { source: pkg.resolved, development: Boolean(pkg.dev) });
}

if (missing.length) throw new Error(`Missing license texts: ${missing.join(", ")}`);
inventory.sort((a, b) => `${a.ecosystem}/${a.name}`.localeCompare(`${b.ecosystem}/${b.name}`));
await writeFile(join(output, "inventory.json"), JSON.stringify(inventory, null, 2) + "\n");
await writeFile(join(root, "THIRD_PARTY_NOTICES.md"), `# Third party notices\n\nContent Workbench is licensed under Apache-2.0. Dependencies retain their own licenses and copyright notices.\n\nThis inventory includes installed npm production dependencies and the resolved macOS arm64 Rust dependency graph, including Rust build dependencies. It is deliberately broader than the code linked into the application. Optional packages for other targets and npm development tools are not bundled. Their declarations remain in the dependency lockfiles.\n\nSee third-party/inventory.json for exact versions and source URLs, and third-party/licenses/ for original license texts. MPL-2.0 components are unmodified; their exact published source archives are included in third-party/sources/. You may obtain, modify and redistribute those components under MPL-2.0. SQLite bundled through libsqlite3-sys is in the public domain; see https://www.sqlite.org/copyright.html.\n\nThe application's document icon is generated from assets/icon.svg. Lucide icons retain their upstream ISC license. Electron is a source-level fallback; this Tauri release does not redistribute the Electron runtime.\n\nPackages recorded: ${inventory.length}. Regenerate with npm ci followed by npm run licenses on macOS arm64.\n`);
console.log(`Collected ${inventory.length} dependency notices.`);
