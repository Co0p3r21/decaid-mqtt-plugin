import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startE2E, waitFor } from "./helpers/fixture.js";

let env;

beforeEach(async () => {
  env = await startE2E({
    settings: {
      ShowButton: true,
      ButtonLabel: "🏠",
    },
  });
});

afterEach(async () => {
  if (env) await env.stop();
});

test("trigger endpoint publishes a non-retained event on <prefix>/event", async () => {
  // Wait until the plugin has connected to the broker.
  await waitFor(() => env.broker.subscriptions.length > 0);

  // Call the trigger endpoint through the plugin's HTTP handler.
  const response = await env.plugin.plugin.__httpRequestHandler({
    requestId: "e2e-1",
    endpoint: "trigger",
    body: { action: 1 },
  });

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);

  // The event message should appear on the broker.
  await waitFor(() =>
    env.broker.publishes.some((p) => p.topic.endsWith("/event")),
  );

  const eventMessages = env.broker.publishes.filter((p) =>
    p.topic.endsWith("/event"),
  );
  assert.equal(eventMessages.length, 1);

  const msg = eventMessages[0];
  assert.equal(msg.payload.toString(), "{}");
  assert.equal(msg.retain, false, "event message must not be retained");
  assert.equal(msg.qos, 1);
});

test("skin endpoint returns the header-button surface", async () => {
  await waitFor(() => env.broker.subscriptions.length > 0);

  const response = await env.plugin.plugin.__httpRequestHandler({
    requestId: "e2e-2",
    endpoint: "skin",
  });

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.version, 1);
  assert.equal(body.surfaces.length, 1);
  assert.equal(body.surfaces[0].label, "🏠");
  assert.equal(body.surfaces[0].kind, "header-button");
  assert.equal(body.surfaces[0].action.type, "call");
  assert.equal(body.surfaces[0].action.endpoint, "trigger");
});

test("skin returns empty surfaces when ShowButton is disabled", async () => {
  await env.stop();
  env = await startE2E({
    settings: { ShowButton: false },
  });

  await waitFor(() => env.broker.subscriptions.length > 0);

  const response = await env.plugin.plugin.__httpRequestHandler({
    requestId: "e2e-3",
    endpoint: "skin",
  });

  const body = JSON.parse(response.body);
  assert.deepEqual(body.surfaces, []);
});

test("existing MQTT state publishing still works alongside the button", async () => {
  await waitFor(() => env.broker.subscriptions.length > 0);

  // Trigger the button event
  await env.plugin.plugin.__httpRequestHandler({
    requestId: "e2e-4",
    endpoint: "trigger",
    body: { action: 1 },
  });

  await waitFor(() =>
    env.broker.publishes.some((p) => p.topic.endsWith("/event")),
  );

  // State messages should still be present (published on connect).
  const stateMessages = env.broker.publishes.filter((p) =>
    p.topic.endsWith("/state"),
  );
  assert.ok(stateMessages.length > 0, "state messages should still be published");

  // Event message should be separate from state.
  const eventMessages = env.broker.publishes.filter((p) =>
    p.topic.endsWith("/event"),
  );
  assert.equal(eventMessages.length, 1);
  assert.notEqual(
    eventMessages[0].topic,
    stateMessages[0].topic,
    "event and state topics must differ",
  );
});
