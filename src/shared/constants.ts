export const AUDIO_TYPES = ["Music", "Ambience", "SFX"] as const;
export type AudioType = (typeof AUDIO_TYPES)[number];

export const LIBRARY_PAGE_SIZE = 100;
export const OPUS_MAX_BITRATE = 192_000;
