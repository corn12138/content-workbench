import { execFileSync } from "node:child_process";
import { readFile, mkdir, stat, writeFile } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";

const root = resolve(import.meta.dirname, "..");
const { version } = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
const config = JSON.parse(
  await readFile(resolve(root, "src-tauri/tauri.conf.json"), "utf8"),
);
const key = process.env.TAURI_SIGNING_PRIVATE_KEY_PATH;
if (!key || !isAbsolute(key) || key.startsWith(root + "/"))
  throw new Error(
    "Set TAURI_SIGNING_PRIVATE_KEY_PATH to a private key outside the source repository.",
  );
const keyInfo = await stat(key);
if ((keyInfo.mode & 0o077) !== 0)
  throw new Error("Signing key must have owner-only permissions.");
if (
  (await readFile(key + ".pub", "utf8")).trim() !==
  config.plugins.updater.pubkey
)
  throw new Error("Signing key does not match the app's public key.");
const app = resolve(root, "release/tauri-macos/内容工作台.app");
const appVersion = execFileSync(
  "/usr/libexec/PlistBuddy",
  [
    "-c",
    "Print :CFBundleShortVersionString",
    resolve(app, "Contents/Info.plist"),
  ],
  { encoding: "utf8" },
).trim();
if (appVersion !== version)
  throw new Error("Build the matching release app before packaging updates.");
execFileSync("codesign", ["--verify", "--deep", "--strict", app], {
  stdio: "pipe",
});
const directory = resolve(root, `release/v${version}`);
await mkdir(directory, { recursive: true });
const name = `content-workbench-${version}-darwin-aarch64.app.tar.gz`;
const artifact = resolve(directory, name);
// Package the final notarization/signing/attribution state, not an earlier compiler output.
execFileSync(
  "/usr/bin/tar",
  ["-czf", artifact, "-C", resolve(app, ".."), "内容工作台.app"],
  { env: { ...process.env, COPYFILE_DISABLE: "1" } },
);
execFileSync(
  resolve(root, "node_modules/.bin/tauri"),
  ["signer", "sign", "-f", key, "--app-version", version, artifact],
  {
    stdio: "pipe",
    env: {
      ...process.env,
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD:
        process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || "",
    },
  },
);
const signature = (await readFile(artifact + ".sig", "utf8")).trim();
await writeFile(
  resolve(directory, "latest.json"),
  JSON.stringify(
    {
      version,
      notes: "掘金目录适配、图片准备与可回退的应用更新。详情见发行说明。",
      pub_date: new Date().toISOString(),
      platforms: {
        "darwin-aarch64": {
          signature,
          url: `https://github.com/corn12138/content-workbench/releases/download/v${version}/${name}`,
        },
      },
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Signed update package and latest.json ready in release/v${version}. Private key was not copied.`,
);
