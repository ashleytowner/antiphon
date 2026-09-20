import {
  test,
  expect,
  _electron as electron,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaults } from "../src/main/settings";

function tone(seconds: number, frequency: number) {
  const rate = 48000,
    samples = seconds * rate;
  const wave = Buffer.alloc(44 + samples * 4);
  wave.write("RIFF");
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(2, 22);
  wave.writeUInt32LE(rate, 24);
  wave.writeUInt32LE(rate * 4, 28);
  wave.writeUInt16LE(4, 32);
  wave.writeUInt16LE(16, 34);
  wave.write("data", 36);
  wave.writeUInt32LE(samples * 4, 40);
  for (let i = 0; i < samples; i++) {
    wave.writeInt16LE(
      Math.round(Math.sin((i / rate) * frequency * Math.PI * 2) * 6000),
      44 + i * 4,
    );
    wave.writeInt16LE(
      Math.round(Math.sin((i / rate) * frequency * 1.5 * Math.PI * 2) * 6000),
      46 + i * 4,
    );
  }
  return wave;
}
async function instrument(page: Page) {
  await page.evaluate(() => {
    const target = window as any;
    target.__peers = [];
    target.__gains = [];
    target.__analysers = [];
    target.__stereo = [];
    const OriginalPeer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends OriginalPeer {
      constructor(config?: RTCConfiguration) {
        super(config);
        target.__peers.push(this);
      }
    };
    const originalGain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () {
      const gain = originalGain.call(this);
      target.__gains.push(gain);
      return gain;
    };
    const originalSource = AudioContext.prototype.createMediaStreamSource;
    AudioContext.prototype.createMediaStreamSource = function (stream) {
      const source = originalSource.call(this, stream);
      const analyser = this.createAnalyser();
      source.connect(analyser);
      target.__analysers.push(analyser);
      const splitter = this.createChannelSplitter(2);
      source.connect(splitter);
      const left = this.createAnalyser(),
        right = this.createAnalyser();
      splitter.connect(left, 0);
      splitter.connect(right, 1);
      target.__stereo.push([left, right]);
      return source;
    };
  });
}
async function energy(page: Page) {
  return page.evaluate(async () => {
    const analyser: AnalyserNode | undefined = (window as any).__analysers.at(
      -1,
    );
    if (!analyser) return 0;
    const values = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(values);
    return (
      values.reduce((sum, value) => sum + value * value, 0) / values.length
    );
  });
}

test("desktop indexes, mixes, classifies and broadcasts audible live audio to a browser", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rpg-desktop-"));
  const library = path.join(directory, "library");
  const userData = path.join(directory, "profile");
  const music = path.join(library, "music/fantasy/Adventure");
  const sfx = path.join(library, "sfx/fantasy/Spells");
  await Promise.all([
    mkdir(userData),
    mkdir(music, { recursive: true }),
    mkdir(sfx, { recursive: true }),
  ]);
  await writeFile(path.join(music, "Test Adventure.wav"), tone(2, 440));
  await writeFile(path.join(music, "Test Adventure Copy.wav"), tone(2, 440));
  await writeFile(path.join(sfx, "Test Spell.wav"), tone(1, 660));
  const port = 31000 + (process.pid % 1000);
  await writeFile(
    path.join(userData, "settings.json"),
    JSON.stringify({
      ...defaults,
      libraryRoot: library,
      port,
      udpMin: 46000,
      udpMax: 46100,
    }),
  );
  let app = await electron.launch({
    args: ["."],
    env: { ...process.env, RPG_USER_DATA: userData, ELECTRON_RUN_AS_NODE: "" },
  });
  const errors: string[] = [];
  app.process().stderr?.on("data", (data) => {
    if (process.env.RPG_TEST_DEBUG) console.log(String(data));
  });
  try {
    const gm = await app.firstWindow();
    gm.on("pageerror", (error) => errors.push(error.message));
    gm.on("console", (message) => {
      if (process.env.RPG_TEST_DEBUG) console.log("GM:", message.text());
    });
    await expect(gm.getByRole("heading", { name: "Antiphon" })).toBeVisible();
    const panePositions = await gm
      .locator(".broadcast-panel, .library-panel, .mixer-panel")
      .evaluateAll((panes) =>
        panes.map((pane) => pane.getBoundingClientRect().x),
      );
    expect(panePositions).toHaveLength(3);
    expect(panePositions[0]).toBeLessThan(panePositions[1]);
    expect(panePositions[1]).toBeLessThan(panePositions[2]);
    await instrument(gm);
    await gm.getByRole("slider", { name: "GM master volume" }).fill("0");
    await gm
      .getByRole("button", { name: "Index audio library", exact: true })
      .click();
    await expect(gm.getByText("Indexed 3 audio files")).toBeVisible();
    await expect(gm.locator(".track")).toHaveCount(3);
    await gm
      .getByRole("button", { name: "Preview Test Adventure", exact: true })
      .click();
    await expect(
      gm.getByRole("button", {
        name: "Stop previewing Test Adventure",
        exact: true,
      }),
    ).toBeVisible();
    await expect(gm.locator(".channel")).toHaveCount(0);
    await gm
      .getByRole("button", {
        name: "Stop previewing Test Adventure",
        exact: true,
      })
      .click();
    await gm.getByRole("searchbox").fill("Adventure");
    await expect(gm.locator(".track")).toHaveCount(2);
    await gm
      .getByRole("button", { name: "Add Test Adventure to mixer", exact: true })
      .click();
    await expect(gm.locator(".channel.playing")).toHaveCount(1);
    await expect(gm.locator(".channel .error")).toHaveCount(0);
    await gm
      .getByRole("button", { name: "Start broadcast", exact: true })
      .click();
    await expect(gm.locator(".status-pill")).toContainText("Live");
    const firstListenUrl = await gm
      .locator(".listen-url code")
      .first()
      .textContent();
    await gm.getByRole("button", { name: "Copy", exact: true }).first().click();
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(firstListenUrl);
    expect(
      await gm.evaluate(
        () => (window as any).__peers.at(-1).remoteDescription.sdp,
      ),
    ).toContain("stereo=1");
    // Use another Electron BrowserWindow as a real Chromium HTTP player.
    const playerPromise = app.waitForEvent("window");
    const listenerUrl = await gm.evaluate(async () =>
      (await window.rpg.serverStatus()).urls.find(
        (url) => !url.includes("localhost"),
      ),
    );
    await app.evaluate(
      async ({ BrowserWindow }, url) => {
        const listener = new BrowserWindow({
          show: false,
          webPreferences: {
            backgroundThrottling: false,
            nodeIntegration: false,
            contextIsolation: true,
          },
        });
        await listener.loadURL(url);
      },
      listenerUrl ?? `http://127.0.0.1:${port}`,
    );
    const player = await playerPromise;
    player.on("pageerror", (error) => errors.push(error.message));
    player.on("console", (message) => {
      if (process.env.RPG_TEST_DEBUG) console.log("Player:", message.text());
    });
    await instrument(player);
    await player.getByRole("slider").fill("0");
    await player.getByRole("button", { name: "Listen live" }).click();
    await expect(player.locator("#status"))
      .toContainText("Live · connected")
      .catch(async (error) => {
        console.log(
          await player.evaluate(() =>
            (window as any).__peers.map((peer: RTCPeerConnection) => ({
              state: peer.connectionState,
              ice: peer.iceConnectionState,
            })),
          ),
        );
        throw error;
      });
    // GM master is zero, but transmitted audio must still decode to nonzero energy.
    await expect
      .poll(() => energy(player))
      .toBeGreaterThan(0.0001)
      .catch(async (error) => {
        for (const page of [gm, player])
          console.log(
            await page.evaluate(async () => {
              const reports: any[] = [];
              for (const peer of (window as any).__peers)
                (await peer.getStats()).forEach((s: any) => {
                  if (
                    ["inbound-rtp", "outbound-rtp", "media-source"].includes(
                      s.type,
                    )
                  )
                    reports.push(s);
                });
              return reports;
            }),
          );
        throw error;
      });
    await expect(gm.locator(".status-pill")).toContainText("1 listener");
    // The fixture has different left/right tones; a mono stream would correlate at 1.
    await expect
      .poll(() =>
        player.evaluate(() => {
          const [left, right]: AnalyserNode[] = (window as any).__stereo.at(-1);
          const a = new Float32Array(left.fftSize),
            b = new Float32Array(right.fftSize);
          left.getFloatTimeDomainData(a);
          right.getFloatTimeDomainData(b);
          let xy = 0,
            xx = 0,
            yy = 0;
          for (let i = 0; i < a.length; i++) {
            xy += a[i] * b[i];
            xx += a[i] ** 2;
            yy += b[i] ** 2;
          }
          return xx > 0 && yy > 0 ? Math.abs(xy / Math.sqrt(xx * yy)) : 1;
        }),
      )
      .toBeLessThan(0.5);
    await gm
      .getByRole("slider", { name: "Volume for Test Adventure", exact: true })
      .fill("0");
    await expect.poll(() => energy(player)).toBeLessThan(0.000001);
    await gm
      .getByRole("slider", { name: "Volume for Test Adventure", exact: true })
      .fill("0.5");
    await expect.poll(() => energy(player)).toBeGreaterThan(0.0001);
    await player.getByRole("button", { name: "Pause" }).click();
    await expect(player.locator("#status")).toContainText("Paused");
    expect(
      await player.evaluate(() => (window as any).__gains[0].gain.value),
    ).toBe(0);
    await expect.poll(() => energy(player)).toBeGreaterThan(0.0001);
    await player.getByRole("button", { name: "Listen live" }).click();
    await expect(player.locator("#status")).toContainText("Live · connected");
    // Music remains playing across its two-second loop boundary.
    await expect(gm.locator(".channel.playing")).toHaveCount(1);
    await gm
      .getByRole("button", { name: "Pause Test Adventure", exact: true })
      .click();
    await expect(gm.locator(".channel.playing")).toHaveCount(0);
    await gm
      .getByRole("button", { name: "Play Test Adventure", exact: true })
      .click();
    await gm
      .locator(".channel")
      .first()
      .getByRole("checkbox", { name: "Loop" })
      .uncheck();
    await expect(
      gm.getByRole("button", { name: "Play Test Adventure", exact: true }),
    ).toBeVisible();
    await gm
      .locator(".channel")
      .first()
      .getByRole("checkbox", { name: "Loop" })
      .check();
    await gm
      .getByRole("button", { name: "Play Test Adventure", exact: true })
      .click();
    await gm.getByRole("searchbox").fill("Spell");
    await expect(gm.locator(".track")).toHaveCount(1);
    await gm.getByRole("button", { name: "Add Test Spell to mixer" }).click();
    await expect(gm.locator(".channel")).toHaveCount(2);
    await expect(
      gm.getByRole("button", { name: "Play Test Spell", exact: true }),
    ).toBeVisible();
    await expect(gm.locator(".channel.playing")).toHaveCount(1);
    await gm.getByRole("button", { name: "Classify Test Spell" }).click();
    await gm.getByLabel("Era", { exact: true }).fill("steampunk");
    await gm.getByRole("button", { name: "Save & mark reviewed" }).click();
    await gm.getByRole("button", { name: "Re-index" }).click();
    await expect(gm.locator(".track")).toHaveCount(1);
    await expect(gm.locator(".track-info").first()).toContainText("steampunk");
    await gm.screenshot({ path: "test-results/desktop.png" });
    await player.screenshot({ path: "test-results/player.png" });
    await gm
      .getByRole("button", { name: "Stop broadcast", exact: true })
      .click();
    await expect(gm.locator(".status-pill")).toContainText("offline");
    await gm
      .getByRole("button", { name: "Start broadcast", exact: true })
      .click();
    await expect(player.locator("#status")).toContainText("Live · connected", {
      timeout: 30_000,
    });
    await expect.poll(() => energy(player)).toBeGreaterThan(0.0001);
    expect(errors).toEqual([]);
    await app.close();
    app = await electron.launch({
      args: ["."],
      env: {
        ...process.env,
        RPG_USER_DATA: userData,
        ELECTRON_RUN_AS_NODE: "",
      },
    });
    const reopened = await app.firstWindow();
    await expect(reopened.locator(".track")).toHaveCount(3);
    await reopened.getByRole("searchbox").fill("Spell");
    await expect(reopened.locator(".track")).toHaveCount(1);
    await expect(reopened.locator(".track-info").first()).toContainText(
      "steampunk",
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("removes individual and all missing tracks from the library database", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rpg-missing-"));
  const library = path.join(directory, "library");
  const userData = path.join(directory, "profile");
  const music = path.join(library, "music/fantasy/Adventure");
  await Promise.all([mkdir(userData), mkdir(music, { recursive: true })]);
  const first = path.join(music, "First.ogg");
  const second = path.join(music, "Second.ogg");
  await Promise.all([writeFile(first, "audio"), writeFile(second, "audio")]);
  await writeFile(
    path.join(userData, "settings.json"),
    JSON.stringify({
      ...defaults,
      libraryRoot: library,
      port: 33000 + (process.pid % 1000),
    }),
  );
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, RPG_USER_DATA: userData, ELECTRON_RUN_AS_NODE: "" },
  });
  try {
    const gm = await app.firstWindow();
    await gm.getByRole("button", { name: "Index audio library" }).click();
    await expect(gm.locator(".track")).toHaveCount(2);

    await rm(first);
    await gm.getByRole("button", { name: "Re-index" }).click();
    await expect(gm.getByText("Include missing (1)")).toBeVisible();
    await gm.getByRole("checkbox", { name: /Include missing/ }).check();
    await gm.getByRole("button", { name: "Remove missing First" }).click();
    const individualDialog = gm.getByRole("dialog", {
      name: "Remove missing track?",
    });
    await expect(individualDialog).toContainText(
      "No audio files will be deleted",
    );
    await individualDialog
      .getByRole("button", { name: "Remove track" })
      .click();
    await expect(gm.locator(".track")).toHaveCount(1);
    await expect(gm.getByText("Include missing (0)")).toBeVisible();

    await rm(second);
    await gm.getByRole("button", { name: "Re-index" }).click();
    await expect(gm.getByText("Include missing (1)")).toBeVisible();
    await gm.getByRole("button", { name: "Remove all missing" }).click();
    const allDialog = gm.getByRole("dialog", {
      name: "Remove all missing tracks?",
    });
    await expect(allDialog).toContainText("1 missing track");
    await allDialog.getByRole("button", { name: "Remove all missing" }).click();
    await expect(gm.getByText("Include missing (0)")).toBeVisible();
    await expect(gm.locator(".track")).toHaveCount(0);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("indexes and plays the existing Ogg library without modifying source files", async () => {
  const root = process.env.RPG_TEST_LIBRARY;
  test.skip(
    !root,
    "Set RPG_TEST_LIBRARY to opt into a real-library smoke test.",
  );
  const userData = await mkdtemp(path.join(os.tmpdir(), "rpg-real-library-"));
  await writeFile(
    path.join(userData, "settings.json"),
    JSON.stringify({
      ...defaults,
      libraryRoot: root,
      port: 32000 + (process.pid % 1000),
    }),
  );
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, RPG_USER_DATA: userData, ELECTRON_RUN_AS_NODE: "" },
  });
  try {
    const gm = await app.firstWindow();
    await gm.getByRole("slider", { name: "GM master volume" }).fill("0");
    await gm
      .getByRole("button", { name: "Index audio library", exact: true })
      .click();
    await expect(gm.locator(".scan-status")).toContainText(
      /Indexed [\d,]+ audio files/,
      { timeout: 45000 },
    );
    console.log(
      "Real library:",
      await gm.evaluate(() =>
        window.rpg.facets().then(({ total, review }) => ({ total, review })),
      ),
    );
    await gm.getByRole("searchbox").fill("Into the Feywilds");
    await gm
      .getByRole("button", { name: /Add Into the Feywilds/ })
      .first()
      .click();
    await expect(gm.locator(".channel.playing")).toHaveCount(1);
    await gm.getByRole("searchbox").fill("Campfire in Woods");
    await gm
      .getByRole("button", { name: /Add Campfire in Woods/ })
      .first()
      .click();
    await expect(gm.locator(".channel.playing")).toHaveCount(2);
    await expect(gm.locator(".channel .error")).toHaveCount(0);
    await gm.screenshot({ path: "test-results/real-library.png" });
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
