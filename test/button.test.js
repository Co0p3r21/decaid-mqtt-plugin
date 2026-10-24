import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlugin } from "../src/main.js";

// Minimal host stub — enough for createPlugin to work without starting
// a real MQTT connection. The plugin is loaded with no broker host so
// `config.enabled` is false and no bridge is created. We can still
// exercise the HTTP handler because the skin endpoint must answer even
// without a machine connection (per the Streamline surface contract).
function createStubHost() {
  const logs = [];
  return {
    logs,
    host: {
      log(msg) { logs.push(msg); },
      emit() {},
      transport: {
        async open() { return { handle: "stub" }; },
        onEvent() {},
        async send() {},
        async close() {},
      },
      storage(cmd) {
        if (cmd?.type === "read") {
          // Immediately deliver a null read so the storage adapter resolves.
          setTimeout(() => {}, 0);
          return Promise.resolve();
        }
        return Promise.resolve();
      },
      fetch: async () => ({ ok: false, status: 404 }),
    },
  };
}

async function loadDisabledPlugin(settingsOverrides = {}) {
  const { host, logs } = createStubHost();
  const plugin = createPlugin(host);
  // Empty Host → plugin stays disabled (no bridge), but config is set.
  await plugin.onLoad({ Host: "", ...settingsOverrides });
  return { plugin, logs };
}

// ── skin endpoint ──────────────────────────────────────────────────

test("skin returns empty surfaces when ShowButton is false", async () => {
  const { plugin } = await loadDisabledPlugin({ ShowButton: false });
  const response = await plugin.__httpRequestHandler({
    requestId: "r1",
    endpoint: "skin",
  });
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.version, 1);
  assert.deepEqual(body.surfaces, []);
});

test("skin returns header-button when ShowButton is true", async () => {
  const { plugin } = await loadDisabledPlugin({ ShowButton: true, ButtonLabel: "☕" });
  const response = await plugin.__httpRequestHandler({
    requestId: "r2",
    endpoint: "skin",
  });
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.surfaces.length, 1);
  const surface = body.surfaces[0];
  assert.equal(surface.kind, "header-button");
  assert.equal(surface.label, "☕");
  assert.equal(surface.action.type, "open");
  assert.equal(surface.action.view, "ui");
});

test("skin uses default emoji when ButtonLabel is not set", async () => {
  const { plugin } = await loadDisabledPlugin({ ShowButton: true });
  const response = await plugin.__httpRequestHandler({
    requestId: "r3",
    endpoint: "skin",
  });
  const body = JSON.parse(response.body);
  assert.equal(body.surfaces[0].label, "🔘");
});

// ── trigger endpoint ───────────────────────────────────────────────

test("trigger returns 503 when MQTT bridge is not running", async () => {
  const { plugin } = await loadDisabledPlugin({ ShowButton: true });
  const response = await plugin.__httpRequestHandler({
    requestId: "r4",
    endpoint: "trigger",
    body: { action: 1 },
  });
  assert.equal(response.status, 503);
  const body = JSON.parse(response.body);
  assert.ok(body.error);
});

// ── unknown endpoint ───────────────────────────────────────────────

test("unknown endpoint returns 404", async () => {
  const { plugin } = await loadDisabledPlugin();
  const response = await plugin.__httpRequestHandler({
    requestId: "r5",
    endpoint: "something-else",
  });
  assert.equal(response.status, 404);
});
