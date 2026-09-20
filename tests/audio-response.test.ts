import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { audioResponse } from "../src/main/audio-response";
import { defaults, validateSettings } from "../src/main/settings";

test("streams byte ranges and handles missing or invalid ranges", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rpg-range-"));
  const file = path.join(directory, "audio.ogg");
  const request = (range?: string) =>
    new Request("https://local/track", {
      headers: range ? { Range: range } : {},
    });
  try {
    await writeFile(file, "0123456789");
    const partial = await audioResponse(file, request("bytes=2-5"));
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get("content-range"), "bytes 2-5/10");
    assert.equal(await partial.text(), "2345");
    assert.equal(
      await (await audioResponse(file, request("bytes=-3"))).text(),
      "789",
    );
    assert.equal(
      await (await audioResponse(file, request())).text(),
      "0123456789",
    );
    assert.equal((await audioResponse(file, request("bytes=10-"))).status, 416);
    assert.equal((await audioResponse(file, request("bytes=4-2"))).status, 416);
    assert.equal(
      (await audioResponse(file, request("bytes=0-1,4-5"))).status,
      416,
    );
    assert.equal((await audioResponse(undefined, request())).status, 404);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("validates configurable network settings", () => {
  assert.deepEqual(validateSettings(defaults), defaults);
  assert.throws(
    () => validateSettings({ ...defaults, udpMax: 40001 }),
    /32 UDP/,
  );
  assert.throws(() => validateSettings({ ...defaults, port: 3.5 }), /integers/);
  assert.throws(
    () =>
      validateSettings({ ...defaults, publicAddress: "http://example.com" }),
    /IPv4/,
  );
});
