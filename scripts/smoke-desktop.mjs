import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import electron from "electron";

const data = await mkdtemp(join(tmpdir(), "workbench-smoke-"));
const binary = process.argv[2] || electron;
const args = process.argv[2]
  ? ["--workbench-smoke"]
  : [".", "--workbench-smoke"];
const child = spawn(binary, args, {
  env: {
    ...process.env,
    WORKBENCH_DATA_DIR: data,
    WORKBENCH_ARTIFACT_DIR: resolve("artifacts/desktop-smoke"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk;
  process.stdout.write(chunk);
});
child.stderr.on("data", (chunk) => process.stderr.write(chunk));
const timeout = setTimeout(() => {
  child.kill("SIGKILL");
}, 60_000);
const code = await new Promise((resolve) => child.on("exit", resolve));
clearTimeout(timeout);
await rm(data, { recursive: true, force: true });
const reportPath = resolve("artifacts/desktop-smoke/result.json");
try {
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  report.nativeCloseAutosave = output.includes("DESKTOP_CLOSE_SAVE_PASS");
  report.passed = code === 0 && output.includes("DESKTOP_SMOKE_PASS");
  await writeFile(reportPath, JSON.stringify(report, null, 2));
} catch {
  /* A failed startup may not have produced a report. */
}
if (code !== 0 || !output.includes("DESKTOP_SMOKE_PASS")) process.exit(1);
