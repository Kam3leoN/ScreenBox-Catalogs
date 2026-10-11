using Microsoft.Data.Sqlite;

namespace ScreenBox.CatalogEditor;

public sealed class MainForm : Form
{
	readonly TextBox _dbPath = new() { Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Top };
	readonly ComboBox _systems = new() { DropDownStyle = ComboBoxStyle.DropDownList, Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Top };
	readonly TextBox _name = new() { Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Top };
	readonly ComboBox _region = new() { DropDownStyle = ComboBoxStyle.DropDownList };
	readonly ComboBox _type = new() { DropDownStyle = ComboBoxStyle.DropDownList };
	readonly TextBox _romName = new() { Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Top };
	readonly TextBox _size = new() { ReadOnly = true };
	readonly TextBox _crc = new() { ReadOnly = true };
	readonly TextBox _md5 = new() { ReadOnly = true };
	readonly TextBox _sha1 = new() { ReadOnly = true };
	readonly Label _status = new() { AutoSize = true, Anchor = AnchorStyles.Left | AnchorStyles.Bottom };

	public MainForm()
	{
		Text = "ScreenBox CatalogEditor";
		Width = 760;
		Height = 560;
		MinimumSize = new Size(640, 480);
		Font = new Font("Segoe UI", 10f);

		_region.Items.AddRange(["europe", "usa", "japan", "world"]);
		_region.SelectedIndex = 0;
		_type.Items.AddRange(["commercial", "prototype", "hack", "homebrew", "unlicensed", "bios", "clone"]);
		_type.SelectedIndex = 0;

		var browseDb = new Button { Text = "Ouvrir DB…", AutoSize = true };
		browseDb.Click += (_, _) => BrowseDb();
		var pickFile = new Button { Text = "Sélectionner fichier ROM…", AutoSize = true };
		pickFile.Click += (_, _) => PickRomFile();
		var save = new Button { Text = "Créer / ajouter ROM", AutoSize = true };
		save.Click += (_, _) => SaveEntry();
		var refresh = new Button { Text = "Rafraîchir systèmes", AutoSize = true };
		refresh.Click += (_, _) => ReloadSystems();

		var layout = new TableLayoutPanel
		{
			Dock = DockStyle.Fill,
			ColumnCount = 2,
			Padding = new Padding(12),
			RowCount = 14,
		};
		layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 140));
		layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

		void Row(int r, string label, Control c)
		{
			layout.Controls.Add(new Label { Text = label, AutoSize = true, Anchor = AnchorStyles.Left }, 0, r);
			layout.Controls.Add(c, 1, r);
			layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
		}

		var dbRow = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false };
		_dbPath.Width = 420;
		dbRow.Controls.Add(_dbPath);
		dbRow.Controls.Add(browseDb);
		dbRow.Controls.Add(refresh);
		Row(0, "Base SQLite", dbRow);
		Row(1, "Système", _systems);
		Row(2, "Nom (région)", _name);
		Row(3, "Région", _region);
		Row(4, "Type", _type);
		Row(5, "Nom fichier ROM", _romName);
		Row(6, "Size", _size);
		Row(7, "CRC32", _crc);
		Row(8, "MD5", _md5);
		Row(9, "SHA1", _sha1);

		var actions = new FlowLayoutPanel { Dock = DockStyle.Fill };
		actions.Controls.Add(pickFile);
		actions.Controls.Add(save);
		layout.Controls.Add(actions, 1, 10);
		layout.SetColumnSpan(_status, 2);
		layout.Controls.Add(_status, 0, 11);

		Controls.Add(layout);

		string? guess = GuessDefaultDb();
		if (guess != null)
		{
			_dbPath.Text = guess;
			ReloadSystems();
		}
	}

	static string? GuessDefaultDb()
	{
		string[] candidates =
		[
			Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "screenbox-catalogs.db")),
			@"G:\ScreenBox\Systems\_shared\Datas\Catalogs\screenbox-catalogs.db",
			Path.Combine(Environment.CurrentDirectory, "screenbox-catalogs.db"),
		];
		return candidates.FirstOrDefault(File.Exists);
	}

	void BrowseDb()
	{
		using var ofd = new OpenFileDialog
		{
			Filter = "SQLite (*.db)|*.db|All|*.*",
			Title = "Ouvrir screenbox-catalogs.db",
		};
		if (ofd.ShowDialog(this) != DialogResult.OK)
			return;
		_dbPath.Text = ofd.FileName;
		ReloadSystems();
	}

	void ReloadSystems()
	{
		_systems.Items.Clear();
		string path = _dbPath.Text.Trim();
		if (!File.Exists(path))
		{
			_status.Text = "DB introuvable.";
			return;
		}

		try
		{
			using var conn = Open(path, readOnly: false);
			EnsureSchema(conn);
			using var cmd = conn.CreateCommand();
			cmd.CommandText = "SELECT id FROM systems ORDER BY id;";
			using var r = cmd.ExecuteReader();
			while (r.Read())
				_systems.Items.Add(r.GetString(0));
			if (_systems.Items.Count > 0)
				_systems.SelectedIndex = 0;
			_status.Text = $"{_systems.Items.Count} système(s).";
		}
		catch (Exception ex)
		{
			_status.Text = ex.Message;
		}
	}

	void PickRomFile()
	{
		using var ofd = new OpenFileDialog { Title = "Fichier ROM / image", Filter = "All|*.*" };
		if (ofd.ShowDialog(this) != DialogResult.OK)
			return;
		try
		{
			_status.Text = "Hash en cours…";
			Application.DoEvents();
			RomHasher.Result h = RomHasher.HashFile(ofd.FileName);
			_romName.Text = Path.GetFileName(ofd.FileName);
			if (string.IsNullOrWhiteSpace(_name.Text))
				_name.Text = Path.GetFileNameWithoutExtension(ofd.FileName);
			_size.Text = h.Size.ToString();
			_crc.Text = h.Crc32;
			_md5.Text = h.Md5;
			_sha1.Text = h.Sha1;
			_status.Text = "Hash OK.";
		}
		catch (Exception ex)
		{
			_status.Text = ex.Message;
		}
	}

	void SaveEntry()
	{
		string path = _dbPath.Text.Trim();
		string? systemId = _systems.SelectedItem as string;
		if (string.IsNullOrWhiteSpace(systemId))
		{
			_status.Text = "Choisissez un système.";
			return;
		}

		if (string.IsNullOrWhiteSpace(_name.Text) || string.IsNullOrWhiteSpace(_romName.Text) || string.IsNullOrWhiteSpace(_sha1.Text))
		{
			_status.Text = "Nom, fichier ROM et hash requis (sélectionnez un fichier).";
			return;
		}

		try
		{
			using var conn = Open(path, readOnly: false);
			using var tx = conn.BeginTransaction();
			long gameId;
			using (var ins = conn.CreateCommand())
			{
				ins.Transaction = tx;
				ins.CommandText = "INSERT INTO games(system_id, parent_game_id) VALUES ($s, NULL);";
				ins.Parameters.AddWithValue("$s", systemId);
				ins.ExecuteNonQuery();
				using var id = conn.CreateCommand();
				id.Transaction = tx;
				id.CommandText = "SELECT last_insert_rowid();";
				gameId = (long)id.ExecuteScalar()!;
			}

			using (var t = conn.CreateCommand())
			{
				t.Transaction = tx;
				t.CommandText = "INSERT INTO game_types(game_id, type) VALUES ($g, $t);";
				t.Parameters.AddWithValue("$g", gameId);
				t.Parameters.AddWithValue("$t", _type.SelectedItem?.ToString() ?? "commercial");
				t.ExecuteNonQuery();
			}

			using (var reg = conn.CreateCommand())
			{
				reg.Transaction = tx;
				reg.CommandText = "INSERT INTO game_regions(game_id, region, name, release) VALUES ($g, $r, $n, NULL);";
				reg.Parameters.AddWithValue("$g", gameId);
				reg.Parameters.AddWithValue("$r", _region.SelectedItem?.ToString() ?? "europe");
				reg.Parameters.AddWithValue("$n", _name.Text.Trim());
				reg.ExecuteNonQuery();
			}

			using (var rom = conn.CreateCommand())
			{
				rom.Transaction = tx;
				rom.CommandText = """
					INSERT INTO roms(game_id, rom, size, crc, md5, sha1)
					VALUES ($g, $rom, $size, $crc, $md5, $sha1);
					""";
				rom.Parameters.AddWithValue("$g", gameId);
				rom.Parameters.AddWithValue("$rom", _romName.Text.Trim());
				rom.Parameters.AddWithValue("$size", long.TryParse(_size.Text, out long sz) ? sz : DBNull.Value);
				rom.Parameters.AddWithValue("$crc", _crc.Text.Trim());
				rom.Parameters.AddWithValue("$md5", _md5.Text.Trim());
				rom.Parameters.AddWithValue("$sha1", _sha1.Text.Trim());
				rom.ExecuteNonQuery();
			}

			tx.Commit();
			_status.Text = $"OK — jeu #{gameId} ajouté dans {systemId}.";
		}
		catch (Exception ex)
		{
			_status.Text = ex.Message;
		}
	}

	static SqliteConnection Open(string path, bool readOnly)
	{
		var b = new SqliteConnectionStringBuilder
		{
			DataSource = path,
			Mode = readOnly ? SqliteOpenMode.ReadOnly : SqliteOpenMode.ReadWriteCreate,
		};
		var c = new SqliteConnection(b.ToString());
		c.Open();
		return c;
	}

	static void EnsureSchema(SqliteConnection conn)
	{
		using var cmd = conn.CreateCommand();
		cmd.CommandText = Schema.CreateSql;
		cmd.ExecuteNonQuery();
	}
}
