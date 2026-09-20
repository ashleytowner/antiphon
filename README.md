# Antiphon

**Your tabletop soundscape, from your local audio collection.**

Antiphon is a desktop app for game masters who want to build and share live music, ambience, and sound effects without handing their collection to a third party. Your audio files, library, and live mix stay on your computer. There is no subscription and no Antiphon account to create.

![Antiphon desktop app: audio library, player broadcast controls, and live mixer](docs/images/desktop.png)

## Bring your sessions to life

Layer an exploration theme beneath forest ambience. Add a sudden door slam. Turn down the music when the party starts talking. Antiphon lets you run the whole soundscape live, then share the same mix with your players.

- **Mix your scene live.** Play several tracks at once, set each track's volume, loop background audio, and use one-shot sound effects when the moment calls for them.
- **Share with browser listeners.** Start a broadcast and give players a simple listening link. Each player controls only their own listening volume.
- **Broadcast to Discord.** Connect a Discord bot and send the same live mix to a voice or stage channel.
- **Keep it yours.** Audio files are played where they already live. Antiphon does not upload or alter them, and its library index stays on your computer.
- **Find the right sound quickly.** Search and filter your collection by music, ambience, or SFX, as well as era and genre.
- **Use the computer you have.** Antiphon is available for Linux, macOS, and Windows.

## See it in action

### Your GM workspace

Browse your collection, build a live mixer, and start a player or Discord broadcast from one place.

![Antiphon desktop workspace](docs/images/desktop.png)

### The player listening page

Players get a focused page with a personal volume control, play/pause, connection status, and automatic reconnection.

![Player listening page](docs/images/player.png)

## How it works

1. **Choose your audio folder.** Antiphon plays files in place, so there is nothing to import or upload.
2. **Index your library.** It scans your collection and helps sort tracks into useful categories.
3. **Set the scene.** Add tracks to the mixer, adjust their levels and loops, then begin broadcasting.

Your own listening volume is separate from the mix your players receive, and every browser listener can choose their own master volume.

## Organise your audio library

Antiphon can work with an existing collection, and it will suggest categories for files that are not already neatly organised. For the most accurate automatic categorisation, use this folder layout:

```text
My Audio Library/
  music/
    fantasy/
      Exploration/
        Into the Feywilds.ogg
  ambience/
    scifi/
      Space Station/
        Engine Hum.ogg
  sfx/
    modern/
      Weapons/
        Door Slam.ogg
```

In other words:

```text
<your library>/<music|ambience|sfx>/<era>/<genre>/<audio file>
```

Antiphon uses that structure to categorise each track by **type**, **era**, and **genre**. If a file is elsewhere, it makes a best-effort suggestion and puts uncertain results in a review list; you can change any category yourself. It also notices files that have gone missing since the last scan.

## Share your mix

### Browser players

Start **Player broadcast** in Antiphon and share one of the listening links it provides. Players open it in a browser and hear the current live mix.

Players on the same local network can use the local link directly. To share with people over the internet, you will need to port-forward Antiphon's webpage port and audio UDP port range from your router to the GM computer, then enter your public IPv4 address in Settings. Keep Antiphon open while the session is running.

<details>
<summary>Advanced connection details</summary>

By default, Antiphon uses TCP port `3000` for the listening page and signaling, plus UDP ports `40000`–`40031` for audio. Some networks that block UDP may require optional STUN or TURN settings.

</details>

### Discord voice channels

Antiphon can also deliver the same mix to one Discord voice or stage channel at a time. Create a Discord bot, invite it to your server with **View Channel**, **Connect**, and **Speak** permissions, then save its bot token in Antiphon's Settings. Choose a channel in the Discord broadcast panel to go live.

The bot token is protected using your operating system's credential storage and is not shown again after saving. Discord and browser broadcasts can run at the same time.

## Local-first by design

Antiphon is a local desktop application, not a subscription service. Your collection stays yours:

- Your audio files are read and played from your computer; they are never modified or uploaded by Antiphon.
- Your library index and mixer run locally on the GM computer.
- Browser player broadcasts are served directly from the GM computer, with no Antiphon-hosted server in between.
- Discord broadcasting is optional; when used, the configured bot connects to Discord to join the selected channel.

## Install or build

Releases include installers for Windows, macOS, and Linux. If you are running Antiphon from source, install Node.js 24 and npm, then run:

```sh
npm install
npm start
```

For packaging and test commands, see the scripts in [`package.json`](package.json).

---

**AI disclosure:** AI coding tools have been used in the development of Antiphon.
