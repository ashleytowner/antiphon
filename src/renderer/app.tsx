import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { DiscordStatus, DiscordVoiceChannel, Facets, LibraryQuery, LibraryResult, ScanProgress, ServerStatus, Settings, Track } from '../shared/types';
import { Mixer, type Channel } from './mixer';
import './style.css';

const api = window.rpg;
const mixer = new Mixer(api);
const describe = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': Error: /, '');
const time = (seconds: number) => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}` : '—';

function ChannelCard({ channel }: { channel: Channel }) {
  const [position, setPosition] = useState('0:00');
  useEffect(() => { const timer = setInterval(() => setPosition(time(channel.audio.currentTime)), 500); return () => clearInterval(timer); }, [channel]);
  return <article className={`channel ${channel.playing ? 'playing' : ''}`}>
    <div className="channel-title"><span className={`type-dot ${channel.track.type.toLowerCase()}`} /><strong>{channel.track.title}</strong><button className="icon quiet" aria-label={`Remove ${channel.track.title}`} onClick={() => mixer.remove(channel.id)}>×</button></div>
    <p className="muted small">{channel.track.era} · {channel.track.genre}</p>
    <div className="channel-controls"><button aria-label={`${channel.playing ? 'Pause' : 'Play'} ${channel.track.title}`} onClick={() => void mixer.toggle(channel.id)}>{channel.playing ? 'Ⅱ Pause' : '▶ Play'}</button><span className="time">{position} / {time(channel.audio.duration)}</span><label className="check"><input type="checkbox" checked={channel.loop} onChange={e => mixer.loop(channel.id, e.target.checked)} />Loop</label></div>
    <label className="volume">Track volume <input aria-label={`Volume for ${channel.track.title}`} type="range" min="0" max="1" step="0.01" value={channel.volume} onChange={e => mixer.volume(channel.id, Number(e.target.value))} /><output>{Math.round(channel.volume * 100)}%</output></label>
    {channel.error && <p className="error small" role="alert">{channel.error}</p>}
  </article>;
}

function ClassificationEditor({ track, facets, close, saved }: { track: Track; facets: Facets; close: () => void; saved: () => void }) {
  const [type, setType] = useState(track.type);
  const [era, setEra] = useState(track.era);
  const [genre, setGenre] = useState(track.genre);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <div className="overlay" onKeyDown={e => { if (e.key === 'Escape') close(); }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="edit-title">
    <h2 id="edit-title">Classify track</h2><h3>{track.title}</h3><p className="muted small path">{track.relativePath}</p><p className="notice">{track.reason}</p>
    <form onSubmit={async e => { e.preventDefault(); setBusy(true); try { await api.classify(track.id, { type, era, genre }); saved(); } catch (error) { setError(describe(error)); } finally { setBusy(false); } }}>
      <label>Type<select autoFocus value={type} onChange={e => setType(e.target.value as Track['type'])}>{['Music', 'Ambience', 'SFX'].map(v => <option key={v}>{v}</option>)}</select></label>
      <label>Era<input required maxLength={100} list="eras" value={era} onChange={e => setEra(e.target.value)} /></label>
      <label>Genre<input required maxLength={100} list="genres" value={genre} onChange={e => setGenre(e.target.value)} /></label>
      <datalist id="eras">{facets.eras.map(v => <option key={v} value={v} />)}</datalist><datalist id="genres">{facets.genres.map(v => <option key={v} value={v} />)}</datalist>
      {error && <p className="error" role="alert">{error}</p>}<div className="actions"><button type="button" onClick={close}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save & mark reviewed'}</button></div>
    </form>
  </section></div>;
}

function SettingsEditor({ initial, discord, close, saved }: { initial: Settings; discord: DiscordStatus; close: () => void; saved: () => Promise<void> }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [discordToken, setDiscordToken] = useState('');
  const [removeDiscordToken, setRemoveDiscordToken] = useState(false);
  const set = (key: keyof Settings, input: string | number) => setValue(current => ({ ...current, [key]: input }));
  return <div className="overlay" onKeyDown={e => { if (e.key === 'Escape' && !busy) close(); }}><section className="dialog settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <h2 id="settings-title">Library & broadcast settings</h2>
    <form onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      try { await mixer.stopAllBroadcasts(); if (value.libraryRoot !== initial.libraryRoot) mixer.clear(); await api.saveSettings(value); if (removeDiscordToken) await api.saveDiscordToken(null); else if (discordToken.trim()) await api.saveDiscordToken(discordToken.trim()); await saved(); }
      catch (error) { setError(describe(error)); }
      finally { setBusy(false); }
    }}>
      <label>Audio library folder<div className="inline"><input autoFocus required value={value.libraryRoot} onChange={e => set('libraryRoot', e.target.value)} /><button type="button" onClick={async () => { try { const folder = await api.chooseLibrary(); if (folder) set('libraryRoot', folder); } catch (error) { setError(describe(error)); } }}>Browse…</button></div></label>
      <p className="muted small">Choose the folder containing Albums and MGS Audio. Files are played in place.</p>
      <div className="settings-grid">{(['port', 'udpMin', 'udpMax'] as const).map((key, i) => <label key={key}>{['Webpage TCP port', 'First UDP media port', 'Last UDP media port'][i]}<input type="number" required min="1024" max="65535" value={value[key]} onChange={e => set(key, Number(e.target.value))} /></label>)}</div>
      <label>Public IPv4 address<input placeholder="e.g. 203.0.113.10 (optional on LAN)" value={value.publicAddress} onChange={e => set('publicAddress', e.target.value.trim())} /></label>
      <p className="notice">For remote players, forward the TCP port and the UDP range to this computer, preserving port numbers. Enter your public IPv4 address above. Saving restarts the server; start broadcasting again afterward.</p>
      <details><summary>Optional STUN / TURN configuration</summary>
        <label>STUN URL<input placeholder="stun:stun.example.com:3478" value={value.stunUrl} onChange={e => set('stunUrl', e.target.value.trim())} /></label>
        <label>TURN URL<input placeholder="turn:turn.example.com:3478?transport=tcp" value={value.turnUrl} onChange={e => set('turnUrl', e.target.value.trim())} /></label>
        <div className="settings-grid"><label>TURN username<input autoComplete="off" value={value.turnUsername} onChange={e => set('turnUsername', e.target.value)} /></label><label>TURN credential<input type="password" autoComplete="off" value={value.turnCredential} onChange={e => set('turnCredential', e.target.value)} /></label></div>
      </details>
      <details><summary>Discord bot</summary>
        <label>Bot token<input type="password" autoComplete="new-password" placeholder={discord.configured ? '•••••••• (saved — leave blank to keep)' : 'Paste a Discord bot token'} value={discordToken} onChange={e => { setDiscordToken(e.target.value); setRemoveDiscordToken(false); }} /></label>
        <p className="muted small">The token is stored using your operating system’s protected storage. Invite the bot with View Channel, Connect, and Speak permissions.</p>
        {discord.configured && <label className="check"><input type="checkbox" checked={removeDiscordToken} onChange={e => { setRemoveDiscordToken(e.target.checked); if (e.target.checked) setDiscordToken(''); }} />Remove saved Discord bot token</label>}
        {!discord.enabled && <p className="notice">Discord broadcasting is disabled by ANTIPHON_DISCORD_ENABLED=false.</p>}
      </details>
      {error && <p className="error" role="alert">{error}</p>}<div className="actions"><button type="button" disabled={busy} onClick={close}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button></div>
    </form>
  </section></div>;
}

function DiscordBroadcast({ status, channels, refresh, report }: { status: DiscordStatus; channels: DiscordVoiceChannel[]; refresh: () => Promise<void>; report: (error: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  if (!status.enabled) return null;
  const connect = async (channel: DiscordVoiceChannel) => {
    setBusy(true);
    try { await mixer.startDiscord(); await api.connectDiscord(channel); await refresh(); }
    catch (error) { await mixer.stopDiscord(); report(error); }
    finally { setBusy(false); }
  };
  const grouped = channels.reduce((groups, channel) => {
    const group = groups.get(channel.guildName) ?? [];
    group.push(channel); groups.set(channel.guildName, group);
    return groups;
  }, new Map<string, DiscordVoiceChannel[]>());
  return <section className="broadcast discord-broadcast"><div className="section-heading"><h3>Discord broadcast</h3><button className="quiet small" disabled={!status.configured || busy} onClick={() => void refresh().catch(report)}>Refresh channels</button></div>
    {!status.configured ? <p className="small muted">Save a Discord bot token in Settings to broadcast your live mix to a server.</p> : <>
      <p className={`small ${status.connected ? 'live-text' : 'muted'}`} role="status">{status.connected && status.channel ? `Live in ${status.channel.guildName} · ${status.channel.name}` : status.error ?? 'Choose a voice channel'}</p>
      {status.connected && <button className="danger" disabled={busy} onClick={() => { setBusy(true); void api.disconnectDiscord().then(() => mixer.stopDiscord()).then(refresh).catch(report).finally(() => setBusy(false)); }}>Disconnect Discord</button>}
      <div className="discord-channels">{[...grouped].map(([guild, voiceChannels]) => <div key={guild}><strong>{guild}</strong>{voiceChannels.map(channel => <button key={channel.id} disabled={busy || status.channel?.id === channel.id} onClick={() => void connect(channel)}>{status.channel?.id === channel.id ? '● ' : '▶ '}{channel.name}{channel.type === 'stage' ? ' (Stage)' : ''}</button>)}</div>)}</div>
    </>}
  </section>;
}

function App() {
  const [settings, setSettings] = useState<Settings>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [facets, setFacets] = useState<Facets>({ eras: [], genres: [], total: 0, review: 0, missing: 0 });
  const [result, setResult] = useState<LibraryResult>({ tracks: [], total: 0 });
  const [query, setQuery] = useState<LibraryQuery>({});
  const [progress, setProgress] = useState<ScanProgress>();
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<Track>();
  const [revision, setRevision] = useState(0);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [server, setServer] = useState<ServerStatus>({ running: false, listeners: 0, broadcasting: false, urls: [] });
  const [discord, setDiscord] = useState<DiscordStatus>({ enabled: true, configured: false, connected: false });
  const [discordChannels, setDiscordChannels] = useState<DiscordVoiceChannel[]>([]);
  const [broadcastState, setBroadcastState] = useState(mixer.broadcastState);
  const [master, setMaster] = useState(mixer.master);
  const requestId = useRef(0);
  const refresh = async () => {
    const [settings, facets, status, discord] = await Promise.all([api.settings(), api.facets(), api.serverStatus(), api.discordStatus()]);
    setSettings(settings); setFacets(facets); setServer(status); setDiscord(discord); setRevision(v => v + 1);
    if (discord.configured && discord.enabled) setDiscordChannels(await api.discordChannels());
  };
  useEffect(() => {
    void refresh().catch(error => setError(describe(error)));
    const unsubscribe = api.onScan(value => {
      setProgress(value);
      if (value.phase === 'done' || value.phase === 'error') { setScanning(false); void refresh().catch(error => setError(describe(error))); }
    });
    const unsubscribeMixer = mixer.subscribe(() => { setChannels(mixer.list()); setBroadcastState(mixer.broadcastState); setMaster(mixer.master); });
    try { const saved = localStorage.getItem('gm-volume'); if (saved !== null) mixer.setMaster(Math.min(1, Math.max(0, Number(saved) || 0))); } catch { /* Optional preference. */ }
    const poll = setInterval(() => { void Promise.all([api.serverStatus(), api.discordStatus()]).then(([server, discord]) => { setServer(server); setDiscord(discord); }).catch(error => setError(describe(error))); }, 2000);
    return () => { unsubscribe(); unsubscribeMixer(); clearInterval(poll); };
  }, []);
  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    const timer = setTimeout(() => { void api.query(query).then(value => { if (id === requestId.current) { setResult(value); setLoading(false); } }).catch(error => { if (id === requestId.current) { setError(describe(error)); setLoading(false); } }); }, 150);
    return () => clearTimeout(timer);
  }, [query, revision]);
  const filter = (field: keyof LibraryQuery, value: unknown) => setQuery(current => ({ ...current, [field]: value, offset: 0 }));
  const scan = async () => { setScanning(true); setError(''); setProgress({ phase: 'scanning', count: 0, message: 'Discovering audio files…' }); try { await api.scan(); } catch (error) { setScanning(false); setError(describe(error)); } };
  return <>
    <header><div className="brand"><img className="brand-icon" src="./icon.png" alt="" width="56" height="56" /><div><h1>Antiphon</h1><p>Your tabletop soundscape</p></div></div><div className="header-actions"><span className={`status-pill ${server.broadcasting ? 'live' : ''}`}>{server.broadcasting ? `● Live · ${server.listeners} listener${server.listeners === 1 ? '' : 's'}` : '○ Broadcast offline'}</span><button disabled={!settings || scanning} onClick={() => setSettingsOpen(true)}>Settings</button></div></header>
    {error && <div className="banner error" role="alert">{error}<button className="quiet" onClick={() => setError('')}>Dismiss</button></div>}
    <div className="workspace"><aside className="broadcast-panel" aria-label="Broadcast controls">
      <section className="broadcast"><div className="section-heading"><h3>Player broadcast</h3><span className={`small ${server.broadcasting ? 'live-text' : 'muted'}`}>{server.listeners} listening</span></div><button className={mixer.playerBroadcast ? 'danger' : 'primary'} disabled={!server.running} onClick={() => { void (mixer.playerBroadcast ? mixer.stopBroadcast() : mixer.startBroadcast()).catch(error => setError(describe(error))); }}>{mixer.playerBroadcast ? 'Stop broadcast' : 'Start broadcast'}</button><p className="small muted" role="status">{server.error ?? broadcastState}</p>{server.urls.map(url => <div className="listen-url" key={url}><code>{url}</code><button className="quiet small" onClick={() => { void api.copyText(url).catch(error => setError(describe(error))); }}>Copy</button></div>)}<p className="small muted">Share the public address with remote players. Keep this app open during your session.</p></section>
      <DiscordBroadcast status={discord} channels={discordChannels} refresh={async () => { const [status, channels] = await Promise.all([api.discordStatus(), api.discordChannels()]); setDiscord(status); setDiscordChannels(channels); }} report={error => setError(describe(error))} />
    </aside><section className="library-panel">
      <div className="section-heading"><div><p className="eyebrow">YOUR COLLECTION</p><h2>Audio library <span className="count">{facets.total.toLocaleString()}</span></h2></div><button disabled={scanning || !settings?.libraryRoot} onClick={() => void scan()}>{scanning ? 'Indexing…' : '↻ Re-index'}</button></div>
      {progress && <div className={`scan-status ${progress.phase === 'error' ? 'error' : ''}`} role="status">{scanning && <progress />}<span>{progress.message}</span>{scanning && <strong>{progress.count.toLocaleString()} files</strong>}</div>}
      <div className="filters"><input className="search" type="search" aria-label="Search tracks" placeholder="Search tracks, albums, and categories…" value={query.search ?? ''} onChange={e => filter('search', e.target.value)} />
        <div className="filter-row"><select aria-label="Filter by type" value={query.type ?? ''} onChange={e => filter('type', e.target.value)}><option value="">All types</option>{['Music', 'Ambience', 'SFX'].map(v => <option key={v}>{v}</option>)}</select><select aria-label="Filter by era" value={query.era ?? ''} onChange={e => filter('era', e.target.value)}><option value="">All eras</option>{facets.eras.map(v => <option key={v}>{v}</option>)}</select><select aria-label="Filter by genre" value={query.genre ?? ''} onChange={e => filter('genre', e.target.value)}><option value="">All genres</option>{facets.genres.map(v => <option key={v}>{v}</option>)}</select></div>
        <div className="filter-options"><label className="check"><input type="checkbox" checked={!!query.reviewOnly} onChange={e => filter('reviewOnly', e.target.checked)} />Needs review ({facets.review})</label><label className="check"><input type="checkbox" checked={!!query.includeMissing} onChange={e => filter('includeMissing', e.target.checked)} />Include missing ({facets.missing})</label><button className="quiet small" onClick={() => setQuery({})}>Clear filters</button></div>
      </div>
      <div className="track-list" aria-busy={loading}>
        {result.tracks.map(track => <article className={`track ${track.missing ? 'missing' : ''}`} key={track.id}><button className="play-track" title={`Play ${track.title}`} aria-label={`Add ${track.title} to mixer`} disabled={track.missing} onClick={() => { void mixer.add(track).catch(error => setError(describe(error))); }}>▶</button><div className="track-info"><h3 title={track.relativePath}>{track.title}</h3><p>{track.album} <span>· {track.era} · {track.genre}</span></p></div><span className={`type-tag ${track.type.toLowerCase()}`}>{track.type}</span><button className={`classify ${track.needsReview ? 'review' : 'quiet'}`} aria-label={`Classify ${track.title}`} title={track.reason} onClick={() => setEdit(track)}>{track.missing ? 'Missing' : track.needsReview ? 'Review' : 'Edit'}</button></article>)}
        {!result.tracks.length && <div className="empty"><span>♫</span><h3>{loading ? 'Loading your library…' : facets.total ? 'No matching tracks' : 'Build your sound library'}</h3><p>{facets.total ? 'Try another search or clear your filters.' : 'Choose your audio folder in Settings, then index it to get started.'}</p>{!facets.total && settings?.libraryRoot && <button className="primary" disabled={scanning} onClick={() => void scan()}>Index audio library</button>}{!settings?.libraryRoot && <button onClick={() => setSettingsOpen(true)}>Choose library folder</button>}</div>}
      </div>
      <footer className="pagination"><span>{result.total.toLocaleString()} matching tracks{result.total > 0 && ` · ${(query.offset ?? 0) + 1}–${Math.min((query.offset ?? 0) + 100, result.total)}`}</span><div><button disabled={!query.offset} onClick={() => setQuery(q => ({ ...q, offset: Math.max(0, (q.offset ?? 0) - 100) }))}>Previous</button><button disabled={(query.offset ?? 0) + 100 >= result.total} onClick={() => setQuery(q => ({ ...q, offset: (q.offset ?? 0) + 100 }))}>Next</button></div></footer>
    </section>
    <aside className="mixer-panel"><div className="section-heading"><div><p className="eyebrow">NOW PLAYING</p><h2>Live mixer <span className="count">{channels.length}</span></h2></div><button className="quiet small" disabled={!channels.length} onClick={() => mixer.clear()}>Stop all</button></div>
      <div className="monitor"><label>Your listening volume <strong>{Math.round(master * 100)}%</strong><input aria-label="GM master volume" type="range" min="0" max="1" step="0.01" value={master} onChange={e => { const value = Number(e.target.value); mixer.setMaster(value); try { localStorage.setItem('gm-volume', String(value)); } catch { /* Optional preference. */ } }} /></label><p className="small muted">Only affects your speakers. Players have their own volume.</p></div>
      <div className="channels">{channels.map(channel => <ChannelCard key={channel.id} channel={channel} />)}{!channels.length && <div className="empty compact"><span>≋</span><h3>Set the scene</h3><p>Play a track from the library.<br />Layer music, ambience, and SFX here.</p></div>}</div>
    </aside></div>
    {edit && <ClassificationEditor track={edit} facets={facets} close={() => setEdit(undefined)} saved={() => { setEdit(undefined); void refresh().catch(error => setError(describe(error))); }} />}
    {settingsOpen && settings && <SettingsEditor initial={settings} discord={discord} close={() => setSettingsOpen(false)} saved={async () => { setSettingsOpen(false); setQuery({}); await refresh(); }} />}
  </>;
}
createRoot(document.getElementById('root')!).render(<App />);
