import { DatabaseSync } from "node:sqlite";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { classify, structuredClassification, titleMatches } from "./classify";
import { AUDIO_TYPES, LIBRARY_PAGE_SIZE } from "../shared/constants";
import type {
  Classification,
  Facets,
  LibraryQuery,
  LibraryResult,
  ScanProgress,
  Track,
} from "../shared/types";

const extensions = new Set([
  ".ogg",
  ".oga",
  ".opus",
  ".mp3",
  ".wav",
  ".flac",
  ".m4a",
  ".aac",
  ".webm",
  ".mp4",
  ".aif",
  ".aiff",
]);
function rowToTrack(row: Record<string, unknown>): Track {
  const type = String(row.type);
  if (!AUDIO_TYPES.some((value) => value === type))
    throw new Error(`Invalid audio type in library database: ${type}`);
  return {
    id: Number(row.id),
    relativePath: String(row.relativePath),
    title: String(row.title),
    album: String(row.album),
    type: type as Track["type"],
    era: String(row.era),
    genre: String(row.genre),
    needsReview: Boolean(row.needsReview),
    reason: String(row.reason),
    missing: Boolean(row.missing),
    manual: Boolean(row.manual),
  };
}
export class Library {
  readonly db: DatabaseSync;
  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS tracks (
        id INTEGER PRIMARY KEY, root TEXT NOT NULL, relativePath TEXT NOT NULL,
        title TEXT NOT NULL, album TEXT NOT NULL, type TEXT NOT NULL, era TEXT NOT NULL, genre TEXT NOT NULL,
        needsReview INTEGER NOT NULL, reason TEXT NOT NULL, manual INTEGER NOT NULL DEFAULT 0,
        missing INTEGER NOT NULL DEFAULT 0, size INTEGER NOT NULL, mtime REAL NOT NULL,
        UNIQUE(root, relativePath));
      CREATE INDEX IF NOT EXISTS track_filters ON tracks(root, missing, type, era, genre);`);
  }
  close() {
    this.db.close();
  }
  query(root: string, query: LibraryQuery): LibraryResult {
    const where = ["root = ?"];
    const args: (string | number)[] = [root];
    if (!query.includeMissing) where.push("missing = 0");
    for (const field of ["type", "era", "genre"] as const)
      if (query[field]) {
        where.push(`${field} = ?`);
        args.push(query[field]!);
      }
    if (query.reviewOnly) where.push("needsReview = 1");
    for (const word of (query.search ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 20)) {
      where.push(
        "(title || ' ' || album || ' ' || relativePath || ' ' || type || ' ' || era || ' ' || genre) LIKE ? ESCAPE '\\'",
      );
      args.push(`%${word.replace(/[\\%_]/g, "\\$&")}%`);
    }
    const condition = where.join(" AND ");
    const total = Number(
      this.db
        .prepare(`SELECT count(*) AS n FROM tracks WHERE ${condition}`)
        .get(...args)!.n,
    );
    const offset = Math.max(0, Math.floor(Number(query.offset) || 0));
    const rows = this.db
      .prepare(
        `SELECT * FROM tracks WHERE ${condition} ORDER BY title COLLATE NOCASE, relativePath LIMIT ${LIBRARY_PAGE_SIZE} OFFSET ?`,
      )
      .all(...args, offset);
    return { tracks: rows.map(rowToTrack), total };
  }
  facets(root: string): Facets {
    const values = (field: string) =>
      this.db
        .prepare(
          `SELECT DISTINCT ${field} AS value FROM tracks WHERE root = ? AND missing = 0 ORDER BY ${field} COLLATE NOCASE`,
        )
        .all(root)
        .map((r) => String(r.value));
    const counts = this.db
      .prepare(
        "SELECT count(*) AS total, coalesce(sum(needsReview),0) AS review, coalesce(sum(missing),0) AS missing FROM tracks WHERE root = ?",
      )
      .get(root)!;
    return {
      eras: values("era"),
      genres: values("genre"),
      total: Number(counts.total),
      review: Number(counts.review),
      missing: Number(counts.missing),
    };
  }
  edit(
    root: string,
    id: number,
    value: Pick<Classification, "type" | "era" | "genre">,
  ) {
    if (
      !AUDIO_TYPES.includes(value.type) ||
      !value.era?.trim() ||
      !value.genre?.trim() ||
      value.era.length > 100 ||
      value.genre.length > 100
    )
      throw new Error("Provide one valid type, era, and genre.");
    const result = this.db
      .prepare(
        "UPDATE tracks SET type=?, era=?, genre=?, needsReview=0, reason=?, manual=1 WHERE root=? AND id=?",
      )
      .run(
        value.type,
        value.era.trim(),
        value.genre.trim(),
        "Manually reviewed",
        root,
        id,
      );
    if (!result.changes) throw new Error("Track not found.");
  }
  file(root: string, id: number): string | undefined {
    const row = this.db
      .prepare(
        "SELECT relativePath FROM tracks WHERE root=? AND id=? AND missing=0",
      )
      .get(root, id);
    return row ? path.join(root, String(row.relativePath)) : undefined;
  }
  async scan(root: string, progress: (value: ScanProgress) => void = () => {}) {
    if (!root || !path.isAbsolute(root))
      throw new Error("Select an absolute library folder first.");
    const files: { relativePath: string; size: number; mtime: number }[] = [];
    let lastUpdate = 0;
    const walk = async (directory: string) => {
      // Fail the scan on inaccessible folders rather than marking their tracks missing.
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(filename);
        else if (
          entry.isFile() &&
          extensions.has(path.extname(entry.name).toLowerCase())
        ) {
          const info = await stat(filename);
          files.push({
            relativePath: path.relative(root, filename),
            size: info.size,
            mtime: info.mtimeMs,
          });
          if (Date.now() - lastUpdate > 150) {
            lastUpdate = Date.now();
            progress({
              phase: "scanning",
              count: files.length,
              message: path.relative(root, filename),
            });
          }
        }
      }
    };
    await walk(root);
    const matches = titleMatches(files.map((f) => f.relativePath));
    progress({
      phase: "saving",
      count: files.length,
      message: "Saving classifications…",
    });
    const upsert = this.db
      .prepare(`INSERT INTO tracks (root,relativePath,title,album,type,era,genre,needsReview,reason,size,mtime)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(root,relativePath) DO UPDATE SET
      title=excluded.title, album=excluded.album, size=excluded.size, mtime=excluded.mtime, missing=0,
      type=CASE WHEN manual THEN type ELSE excluded.type END,
      era=CASE WHEN manual THEN era ELSE excluded.era END,
      genre=CASE WHEN manual THEN genre ELSE excluded.genre END,
      needsReview=CASE WHEN manual THEN needsReview ELSE excluded.needsReview END,
      reason=CASE WHEN manual THEN reason ELSE excluded.reason END`);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE tracks SET missing=1 WHERE root=?").run(root);
      for (const file of files) {
        const structured = structuredClassification(file.relativePath);
        const category = structured ?? classify(file.relativePath, matches);
        const parts = file.relativePath.split(/[\\/]/);
        const album = structured ? parts[0] : (parts[1] ?? parts[0] ?? "");
        upsert.run(
          root,
          file.relativePath,
          path.parse(file.relativePath).name,
          album,
          category.type,
          category.era,
          category.genre,
          Number(category.needsReview),
          category.reason,
          file.size,
          file.mtime,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    progress({
      phase: "done",
      count: files.length,
      message: `Indexed ${files.length.toLocaleString()} audio files`,
    });
    return files.length;
  }
}
