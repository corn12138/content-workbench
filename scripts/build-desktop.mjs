import { build } from "esbuild";

await build({
  entryPoints: ["src/desktop/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron"],
  outfile: "dist/desktop/main.cjs",
  sourcemap: true,
});
await build({
  entryPoints: ["src/desktop/preload.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron"],
  outfile: "dist/desktop/preload.cjs",
});
