# Antiphon

A local-first Electron application for tabletop music, ambience, and sound effects. The GM indexes audio files once, mixes several tracks live, and broadcasts that exact mix to players through a minimal listening page.

## What it does

- Thick client: audio files, SQLite index, and mixing stay on the GM computer.
- Indexes every audio file under a chosen library folder and supports re-indexing.
- Assigns exactly one Type, Era, and Genre to each track. Structured `MGS Audio/<type>/<era>/<genre>` folders are read directly; album tracks receive an inferred category marked for review.
- Searchable library with type/era/genre filters, review queue, missing-file tracking, and per-track classification editing.
- Click-to-play multitrack mixer: independent play/pause, per-track volume, loop/stop toggle, GM-only listening volume, and one-shot SFX defaults.
- Serves a minimal player page with play/pause, personal volume, connection status, live-position listening, pause-as-mute, and automatic reconnect.
- Low-latency WebRTC broadcast using stereo Opus. GM relative volumes are shared; every listener has an independent master volume.

## Run it

Requires Node.js 24 and npm.

```sh
npm install
npm start
```

On first launch, choose the folder containing `Albums` and `MGS Audio`, then select Index audio library. Files play in place and are never modified.

## Player connections

Default settings:

- Webpage/signaling TCP port: `3000`
- WebRTC UDP media range: `40000-40031`
- Local listening URLs are shown in the Player broadcast panel.

For remote players:

1. Forward the TCP port and UDP range to the GM computer, preserving port numbers.
2. Enter the public IPv4 address in Settings.
3. Start broadcasting and share a listening URL.
4. Keep the desktop app open during the session.

Networks that block UDP may need optional STUN/TURN settings in the same Settings dialog.

## Checks and packaging

```sh
npm run build
npm test
npm run test:desktop
RPG_TEST_LIBRARY="/path/to/RPG Music & Ambience" npm run test:desktop
npm run package
```

`npm test` covers indexing, classification, local audio streaming, single-port signaling, and an eight-listener WebRTC relay test. `npm run test:desktop` launches Electron and verifies indexing, mixing, classification edits, restart persistence, stereo separation, live player audio, pause behavior, and reconnects. The optional `RPG_TEST_LIBRARY` smoke test indexes a real Ogg collection without changing its files. `npm run package` creates installers for the current OS.
