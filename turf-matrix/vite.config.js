import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const liveFiles = {
  weekData: resolve("tools/week-data.json"),
  allRaceSignals: resolve("tools/all-race-signals.json"),
};

const liveDataVersion = () => {
  const hash = createHash("sha256");
  hash.update(readFileSync(liveFiles.weekData));
  hash.update(readFileSync(liveFiles.allRaceSignals));
  return hash.digest("hex").slice(0, 16);
};

const liveManifest = (version) => ({
  schemaVersion: 1,
  version,
  weekDataUrl: `/live/week-data.json?v=${version}`,
  allRaceSignalsUrl: `/live/all-race-signals.json?v=${version}`,
});

const liveDataPlugin = () => ({
  name: "turf-matrix-live-data",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const pathname = new URL(request.url, "http://localhost").pathname;
      const sourcePath = pathname === "/live/week-data.json"
        ? liveFiles.weekData
        : pathname === "/live/all-race-signals.json"
          ? liveFiles.allRaceSignals
          : null;

      if (sourcePath) {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(readFileSync(sourcePath));
        return;
      }
      if (pathname === "/live/version.json") {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(JSON.stringify(liveManifest(liveDataVersion())));
        return;
      }
      next();
    });
  },
  generateBundle() {
    const version = liveDataVersion();
    this.emitFile({ type: "asset", fileName: "live/week-data.json", source: readFileSync(liveFiles.weekData) });
    this.emitFile({ type: "asset", fileName: "live/all-race-signals.json", source: readFileSync(liveFiles.allRaceSignals) });
    this.emitFile({
      type: "asset",
      fileName: "live/version.json",
      source: `${JSON.stringify(liveManifest(version))}\n`,
    });
  },
});

const embeddedDataVersion = liveDataVersion();

export default defineConfig({
  plugins: [react(), liveDataPlugin()],
  define: {
    __TURF_MATRIX_DATA_VERSION__: JSON.stringify(embeddedDataVersion),
  },
});
