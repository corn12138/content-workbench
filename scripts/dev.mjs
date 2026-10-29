import { createServer } from "vite";
import { spawn } from "node:child_process";
import electron from "electron";

await import("./build-desktop.mjs");
const server = await createServer();
await server.listen();
const child = spawn(electron, ["."], {
  stdio: "inherit",
  env: { ...process.env, WORKBENCH_DEV_URL: "http://127.0.0.1:5173" },
});
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  child.kill();
  await server.close();
  process.exit(code);
}
child.on("exit", (code) => void stop(code ?? 0));
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
