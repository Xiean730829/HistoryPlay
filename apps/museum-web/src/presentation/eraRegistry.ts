export type EraId = "tang" | "song";

export interface EraDefinition {
  id: EraId;
  title: string;
  packId: string;
  version: string;
  galleryId: string;
  pageSize: 3 | 4;
  presentation: "river" | "song_scroll";
}

/** The Song candidate is opt-in; the running Tang pack is never replaced. */
export const eraRegistry: Readonly<Record<EraId, EraDefinition>> = {
  tang: {
    id: "tang", title: "唐代 · 星河寻珍",
    packId: import.meta.env.VITE_MUSEUM_PACK_ID?.trim() || "cn.tang.core",
    version: import.meta.env.VITE_MUSEUM_PACK_VERSION?.trim() || "0.3.8",
    galleryId: import.meta.env.VITE_MUSEUM_GALLERY_ID?.trim() || "cn.tang.gallery.main",
    pageSize: 4, presentation: "river",
  },
  song: {
    id: "song", title: "宋代 · 画卷人间",
    packId: "cn.song.core",
    version: import.meta.env.VITE_MUSEUM_SONG_VERSION?.trim() || "0.1.0",
    galleryId: "cn.song.gallery.main",
    pageSize: 3, presentation: "song_scroll",
  },
};

export function eraSessionKey(era: EraDefinition): string {
  return `history-play.era-session.v1:${era.id}:${era.packId}:${era.version}`;
}
