import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("The first release is validated only on macOS arm64.");
}
const root = await realpath(resolve(import.meta.dirname, ".."));
const home = await realpath(homedir());
// Panic locations and bundled C sources must not expose the release builder's private filesystem paths.
const flags = process.env.CARGO_ENCODED_RUSTFLAGS?.split("\x1f") ?? process.env.RUSTFLAGS?.split(/\s+/).filter(Boolean) ?? [];
flags.push(`--remap-path-prefix=${home}=/build`, `--remap-path-prefix=${root}=/workspace/content-workbench`);
const env = { ...process.env, CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS || "4", CC_SHELL_ESCAPED_FLAGS: "1", CARGO_ENCODED_RUSTFLAGS: flags.join("\x1f"), CFLAGS: `${process.env.CFLAGS || ""} "-ffile-prefix-map=${home}=/build" "-ffile-prefix-map=${root}=/workspace/content-workbench"` };
delete env.RUSTFLAGS;
const result = spawnSync(resolve(root, "node_modules/.bin/tauri"), ["build", "--bundles", "app", "--ci", "--no-sign", "--", "--locked"], { cwd: root, env, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const staged = spawnSync(process.execPath, ["scripts/stage-tauri.mjs"], { cwd: root, stdio: "inherit" });
if (staged.error) throw staged.error;
if (staged.status !== 0) process.exit(staged.status ?? 1);
// Ad-hoc signing seals the bundled resources; it does not provide a Developer ID or notarization.
const signed = spawnSync("codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", resolve(root, "release/tauri-macos/内容工作台.app")], { stdio: "inherit" });
if (signed.error) throw signed.error;
process.exit(signed.status ?? 1);
