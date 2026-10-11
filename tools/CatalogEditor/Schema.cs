namespace ScreenBox.CatalogEditor;

internal static class Schema
{
	public const string CreateSql = """
		PRAGMA foreign_keys = ON;
		CREATE TABLE IF NOT EXISTS catalog_meta (
		  key TEXT PRIMARY KEY NOT NULL,
		  value TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS systems (
		  id TEXT PRIMARY KEY NOT NULL,
		  source TEXT NOT NULL,
		  version TEXT
		);
		CREATE TABLE IF NOT EXISTS games (
		  id INTEGER PRIMARY KEY,
		  system_id TEXT NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
		  parent_game_id INTEGER NULL REFERENCES games(id) ON DELETE SET NULL
		);
		CREATE TABLE IF NOT EXISTS game_types (
		  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
		  type TEXT NOT NULL,
		  PRIMARY KEY (game_id, type)
		);
		CREATE TABLE IF NOT EXISTS game_regions (
		  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
		  region TEXT NOT NULL,
		  name TEXT NOT NULL,
		  release INTEGER NULL,
		  PRIMARY KEY (game_id, region)
		);
		CREATE TABLE IF NOT EXISTS roms (
		  id INTEGER PRIMARY KEY,
		  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
		  rom TEXT NOT NULL,
		  size INTEGER NULL,
		  crc TEXT NULL,
		  md5 TEXT NULL,
		  sha1 TEXT NULL
		);
		CREATE INDEX IF NOT EXISTS ix_roms_sha1 ON roms(sha1);
		CREATE INDEX IF NOT EXISTS ix_roms_md5 ON roms(md5);
		CREATE INDEX IF NOT EXISTS ix_roms_crc ON roms(crc);
		CREATE INDEX IF NOT EXISTS ix_games_system ON games(system_id);
		""";
}
