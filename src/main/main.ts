import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  protocol,
  powerSaveBlocker,
} from "electron";
import path from "node:path";
import { existsSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { Library } from "./library";
import {
  loadSettings,
  storeSettings,
  defaults,
  validateSettings,
} from "./settings";
import { audioResponse } from "./audio-response";
import { PlayerServer, validateOffer } from "./server";
import { DiscordBroadcaster } from "./discord";
import { loadDiscordToken, storeDiscordToken } from "./discord-secrets";
import type {
  DiscordVoiceChannel,
  ScanProgress,
  Settings,
} from "../shared/types";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "rpg-audio",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);
if (process.env.RPG_USER_DATA)
  app.setPath("userData", process.env.RPG_USER_DATA);
let server: PlayerServer | undefined;
let worker: Worker | undefined;
let library: Library;
let settings: Settings;
let serverError: string | undefined;
let quitting = false;
let saving = false;
let broadcasting = false;
let blocker: number | undefined;
let discord: DiscordBroadcaster | undefined;
let discordToken: string | undefined;

async function stopBroadcast() {
  await server?.relay.stopPublisher();
  if (blocker !== undefined) {
    powerSaveBlocker.stop(blocker);
    blocker = undefined;
  }
}

app
  .whenReady()
  .then(async () => {
    const icon = path.join(__dirname, "../renderer/icon.png");
    if (process.platform === "darwin") app.dock?.setIcon(icon);
    const settingsFile = path.join(app.getPath("userData"), "settings.json");
    const discordFile = path.join(app.getPath("userData"), "discord.json");
    try {
      settings = await loadSettings(settingsFile);
    } catch (error) {
      dialog.showErrorBox("Unable to load settings", String(error));
      settings = { ...defaults };
    }
    try {
      discordToken = await loadDiscordToken(discordFile);
    } catch (error) {
      dialog.showErrorBox("Unable to load Discord credentials", String(error));
    }
    if (!settings.libraryRoot) {
      const nearby = path.resolve(
        app.isPackaged ? path.dirname(app.getPath("exe")) : app.getAppPath(),
        "../RPG Music & Ambience",
      );
      if (existsSync(nearby)) settings.libraryRoot = nearby;
    }
    const database = path.join(app.getPath("userData"), "library.sqlite");
    library = new Library(database);
    const startServer = async (
      configuration = settings,
    ): Promise<PlayerServer | undefined> => {
      const next = new PlayerServer(
        configuration,
        path.join(__dirname, "../player"),
      );
      try {
        await next.start();
        server = next;
        serverError = undefined;
      } catch (error) {
        await next.close();
        server = undefined;
        serverError = String((error as Error).message);
      }
      return server;
    };
    const initialServer = await startServer();
    if (initialServer) {
      discord = new DiscordBroadcaster(initialServer.relay);
      await discord.configure(discordToken ?? null);
    }
    protocol.handle("rpg-audio", (request) => {
      const url = new URL(request.url);
      const id = /^\/([1-9]\d*)$/.exec(url.pathname)?.[1];
      return audioResponse(
        url.hostname === "track" && id
          ? library.file(settings.libraryRoot, Number(id))
          : undefined,
        request,
      );
    });
    const window = new BrowserWindow({
      width: 1400,
      height: 950,
      minWidth: 1000,
      minHeight: 650,
      backgroundColor: "#ffffff",
      title: "Antiphon",
      icon,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    window.setMenuBarVisibility(false);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    const handle = (channel: string, callback: (...args: any[]) => unknown) =>
      ipcMain.handle(channel, (event, ...args) => {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          throw new Error("Untrusted application frame.");
        return callback(...args);
      });
    handle("settings:get", () => settings);
    handle("settings:save", async (value: Settings) => {
      if (worker || saving || broadcasting)
        throw new Error(
          "Wait for indexing or connection setup to finish before changing settings.",
        );
      saving = true;
      try {
        const next = validateSettings(value);
        const previous = settings;
        await stopBroadcast();
        await discord?.close();
        discord = undefined;
        await server?.close();
        server = undefined;
        let attemptedServer: PlayerServer | undefined;
        try {
          attemptedServer = await startServer(next);
          if (!attemptedServer)
            throw new Error(
              `The server could not start with these settings: ${serverError}`,
            );
          discord = new DiscordBroadcaster(attemptedServer.relay);
          await discord.configure(discordToken ?? null);
          await storeSettings(settingsFile, next);
          settings = next;
        } catch (error) {
          const failure =
            error instanceof Error ? error.message : String(error);
          await discord?.close();
          discord = undefined;
          await attemptedServer?.close();
          server = undefined;
          const restoredServer = await startServer(previous);
          if (restoredServer) {
            discord = new DiscordBroadcaster(restoredServer.relay);
            await discord.configure(discordToken ?? null);
          }
          const recovery = restoredServer
            ? "The previous settings were restored."
            : `The previous server also could not restart: ${serverError}`;
          throw new Error(`${failure} ${recovery}`);
        }
      } finally {
        saving = false;
      }
    });
    handle("library:choose", async () => {
      const result = await dialog.showOpenDialog(window, {
        properties: ["openDirectory"],
        defaultPath: settings.libraryRoot || app.getPath("music"),
      });
      return result.canceled ? null : result.filePaths[0];
    });
    handle("library:query", (query) =>
      library.query(settings.libraryRoot, query ?? {}),
    );
    handle("library:facets", () => library.facets(settings.libraryRoot));
    handle("library:remove-missing", (id: unknown) => {
      if (worker || saving)
        throw new Error("Wait for indexing or settings changes to finish.");
      if (!Number.isSafeInteger(id) || Number(id) <= 0)
        throw new Error("Invalid track.");
      library.removeMissing(settings.libraryRoot, Number(id));
    });
    handle("library:remove-all-missing", () => {
      if (worker || saving)
        throw new Error("Wait for indexing or settings changes to finish.");
      return library.removeAllMissing(settings.libraryRoot);
    });
    handle("library:edit", (id, value) =>
      library.edit(settings.libraryRoot, id, value),
    );
    handle("library:scan", () => {
      if (worker || saving)
        throw new Error("An index or settings update is already in progress.");
      if (!settings.libraryRoot)
        throw new Error("Choose your audio library in Settings first.");
      let completed = false;
      worker = new Worker(path.join(__dirname, "scan-worker.js"), {
        workerData: { root: settings.libraryRoot, database },
      });
      const notify = (progress: ScanProgress) => {
        if (!window.isDestroyed())
          window.webContents.send("library:progress", progress);
      };
      worker.on("message", (progress: ScanProgress) => {
        if (progress.phase === "done" || progress.phase === "error")
          completed = true;
        notify(progress);
      });
      worker.on("error", (error) => {
        completed = true;
        notify({ phase: "error", count: 0, message: error.message });
      });
      worker.on("exit", () => {
        worker = undefined;
        if (!completed)
          notify({
            phase: "error",
            count: 0,
            message: "Indexer stopped unexpectedly. Please re-index.",
          });
      });
    });
    handle(
      "server:status",
      () =>
        server?.status() ?? {
          running: false,
          broadcasting: false,
          listeners: 0,
          urls: [],
          error: serverError,
        },
    );
    handle(
      "discord:status",
      () =>
        discord?.status() ?? {
          enabled: process.env.ANTIPHON_DISCORD_ENABLED !== "false",
          configured: !!discordToken,
          connected: false,
          error: serverError,
        },
    );
    handle(
      "discord:channels",
      () =>
        discord?.channels() ??
        Promise.reject(new Error(serverError ?? "Server is not ready.")),
    );
    handle("discord:token", async (token: unknown) => {
      if (
        token !== null &&
        (typeof token !== "string" || !token.trim() || token.length > 4096)
      )
        throw new Error(
          "Provide a valid Discord bot token or remove the saved token.",
        );
      const next = typeof token === "string" ? token.trim() : null;
      await storeDiscordToken(discordFile, next);
      discordToken = next ?? undefined;
      await discord?.configure(next);
    });
    handle("discord:connect", (channel: DiscordVoiceChannel) => {
      if (
        !channel ||
        typeof channel.id !== "string" ||
        typeof channel.guildId !== "string" ||
        typeof channel.name !== "string"
      )
        throw new Error("Invalid Discord voice channel.");
      return (
        discord?.connect(channel) ??
        Promise.reject(new Error(serverError ?? "Server is not ready."))
      );
    });
    handle("discord:disconnect", () => discord?.disconnect());
    handle("clipboard:write", (text: unknown) => {
      if (typeof text !== "string" || text.length > 10_000)
        throw new Error("Invalid clipboard text.");
      clipboard.writeText(text);
    });
    handle("broadcast:start", async (offer) => {
      if (!server || saving)
        throw new Error(serverError ?? "Server is not ready.");
      if (broadcasting)
        throw new Error("Broadcast connection is already being prepared.");
      broadcasting = true;
      try {
        const answer = await server.relay.publish(validateOffer(offer));
        blocker ??= powerSaveBlocker.start("prevent-app-suspension");
        return answer;
      } finally {
        broadcasting = false;
      }
    });
    handle("broadcast:stop", async () => {
      await stopBroadcast();
    });
    handle("broadcast:enable-listeners", () => {
      server?.relay.enableListeners();
    });
    handle("broadcast:disable-listeners", () =>
      server?.relay.disableListeners(),
    );
    window.webContents.on("render-process-gone", () => {
      void stopBroadcast();
    });
    await window.loadFile(path.join(__dirname, "../renderer/index.html"));
  })
  .catch((error) => {
    dialog.showErrorBox("Unable to start Antiphon", String(error));
    app.quit();
  });
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void Promise.allSettled([
    worker?.terminate(),
    discord?.close(),
    stopBroadcast(),
  ])
    .then(() => server?.close())
    .finally(() => {
      library?.close();
      app.quit();
    });
});
app.on("window-all-closed", () => app.quit());
