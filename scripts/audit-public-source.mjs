import { execFileSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
if (!files.length) throw new Error("Stage the public candidate before auditing it.");
const issues = [];
for (const file of files) {
  const path = resolve(root, file);
  const info = await lstat(path);
  if (!info.isFile()) { issues.push(`${file}: non-regular file`); continue; }
  if (/(^|\/)(node_modules|target|dist|release|artifacts|\.local-data|\.tauri-data)(\/|$)|(^|\/)\.env($|\.)|\.(sqlite(-.*)?|db(-.*)?|pem|p12|pfx|key|log)$/i.test(file)) issues.push(`${file}: private or generated artifact`);
  const bytes = await readFile(path);
  // Scan bytes as well as text: generated images and binaries can carry private path metadata.
  if (/\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/|\/private\/var\/folders\/|[A-Z]:\\Users\\/i.test(bytes.toString("utf8"))) issues.push(`${file}: machine-specific path`);
}
if (issues.length) throw new Error(issues.join("\n"));
console.log(`Public source structure and path check passed (${files.length} files). Run Gitleaks separately for secrets.`);
