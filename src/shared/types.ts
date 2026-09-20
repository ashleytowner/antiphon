export type AudioType = 'Music' | 'Ambience' | 'SFX';
export interface Classification {
  type: AudioType;
  era: string;
  genre: string;
  needsReview: boolean;
  reason: string;
}
export interface Track extends Classification {
  id: number;
  relativePath: string;
  title: string;
  album: string;
  missing: boolean;
  manual: boolean;
}
export interface LibraryQuery {
  search?: string;
  type?: string;
  era?: string;
  genre?: string;
  reviewOnly?: boolean;
  includeMissing?: boolean;
  offset?: number;
}
export interface LibraryResult { tracks: Track[]; total: number }
export interface Facets { eras: string[]; genres: string[]; total: number; review: number; missing: number }
export interface Settings {
  libraryRoot: string;
  port: number;
  udpMin: number;
  udpMax: number;
  publicAddress: string;
  stunUrl: string;
  turnUrl: string;
  turnUsername: string;
  turnCredential: string;
}
export interface ScanProgress { phase: 'scanning' | 'saving' | 'done' | 'error'; count: number; message: string }
export interface ServerStatus { running: boolean; listeners: number; broadcasting: boolean; urls: string[]; error?: string }
export interface DesktopAPI {
  settings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  chooseLibrary(): Promise<string | null>;
  scan(): Promise<void>;
  query(query: LibraryQuery): Promise<LibraryResult>;
  facets(): Promise<Facets>;
  classify(id: number, classification: Pick<Classification, 'type' | 'era' | 'genre'>): Promise<void>;
  broadcast(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit>;
  stopBroadcast(): Promise<void>;
  serverStatus(): Promise<ServerStatus>;
  copyText(text: string): Promise<void>;
  onScan(callback: (progress: ScanProgress) => void): () => void;
}
