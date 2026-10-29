import { cp, mkdir, rename, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

const source = resolve("src-tauri/target/release/bundle/macos/内容工作台 Tauri.app");
const directory = resolve("release/tauri-macos");
const destination = resolve(directory, "内容工作台.app");
const staged = resolve(directory, `.workbench-${randomUUID()}.app`);
const previous = resolve(directory, `内容工作台-${Date.now()}.app`);
await stat(resolve(source, "Contents/MacOS/content-workbench-tauri"));
await mkdir(directory, { recursive: true });
await cp(source, staged, { recursive: true });
// Attribution must remain available when users share the app without the source repository.
await cp(resolve("NOTICE"), resolve(staged, "Contents/Resources/legal/NOTICE"));
let moved = false;
try {
  try { await rename(destination, previous); moved = true; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  await rename(staged, destination);
} catch (error) {
  if (moved) await rename(previous, destination);
  await rm(staged, { recursive: true, force: true });
  throw error;
}
console.log(destination);
