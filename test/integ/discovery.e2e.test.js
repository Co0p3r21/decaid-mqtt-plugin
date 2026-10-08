import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import mqtt from "mqtt";
import { startE2E } from "./helpers/fixture.js";
import { waitFor } from "./helpers/broker.js";

let env;

beforeEach(async () => {
  env = await startE2E({
    settings: {
      HaAutoDiscoveryEnable: true,
    }
  });
});

afterEach(async () => {
  if (env) await env.stop();
});

test("publishes HA discovery entities on connect when enabled", async () => {
  env.sim.state.machineInfo = { model: "DE1XXL", firmwareVersion: "1234" };
  env.sim.state.profiles = [{ profile: { title: "Test Profile" } }];
  
  await waitFor(() => env.broker.subscriptions.length > 0);
  await waitFor(() => env.broker.publishes.some((p) => p.topic.includes("/config")));

  const discoveryMessages = env.broker.publishes.filter((p) =>
    p.topic.startsWith("homeassistant/") && p.topic.endsWith("/config")
  );

  assert.equal(discoveryMessages.length, 14);

  assert.ok(discoveryMessages.every((m) => m.retain === true));
  assert.ok(discoveryMessages.every((m) => m.qos === 1));

  const stateEntity = discoveryMessages.find((m) => m.topic.includes("state/config"));
  assert.ok(stateEntity);
  const payload = JSON.parse(stateEntity.payload.toString());
  assert.equal(payload.device.model, "DE1XXL");
  assert.equal(payload.device.sw_version, "1234");
});

test("does not publish HA discovery when disabled", async () => {
  await env.stop();
  env = await startE2E({
    settings: {
      HaAutoDiscoveryEnable: false,
    }
  });
  
  await waitFor(() => env.broker.subscriptions.length > 0);
  await new Promise((r) => setTimeout(r, 100));

  const discoveryMessages = env.broker.publishes.filter((p) =>
    p.topic.startsWith("homeassistant/") && p.topic.endsWith("/config")
  );
  assert.equal(discoveryMessages.length, 0);
});

test("re-publishes discovery configs when a profile command is received", async () => {
  env.sim.state.profiles = [{ profile: { title: "Profile A" } }];
  await waitFor(() => env.broker.subscriptions.length > 0);

  env.broker.publishes.length = 0;

  env.sim.state.profiles = [{ profile: { title: "Profile B" } }, { profile: { title: "Profile C" } }];
  
  const commandTopic = env.broker.connections[0].id.replace("de1plus_", "de1plus/") + "/command";
  const sender = mqtt.connect(`mqtt://127.0.0.1:${env.broker.port}`, { clean: true });
  try {
    await new Promise((resolve, reject) => {
      sender.once("connect", resolve);
      sender.once("error", reject);
    });
    await new Promise((resolve, reject) => {
      sender.publish(commandTopic, "profile Profile B", { qos: 1 }, (e) => (e ? reject(e) : resolve()));
    });

    await waitFor(() => {
      return env.broker.publishes.some((p) =>
        p.topic.startsWith("homeassistant/") && p.topic.endsWith("/config")
      );
    }, 5000);
  } finally {
    await new Promise((resolve) => sender.end(true, {}, resolve));
  }

  const discoveryMessages = env.broker.publishes.filter((p) =>
    p.topic.startsWith("homeassistant/") && p.topic.endsWith("/config")
  );
  
  assert.equal(discoveryMessages.length, 14);
  const selectEntity = discoveryMessages.find((m) => m.topic.includes("profile_select/config"));
  assert.ok(selectEntity);
  const payload = JSON.parse(selectEntity.payload.toString());
  assert.deepEqual(payload.options, ["Profile B", "Profile C"]);
});
