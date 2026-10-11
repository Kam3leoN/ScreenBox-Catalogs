using System.Buffers;
using System.Security.Cryptography;

namespace ScreenBox.CatalogEditor;

internal static class RomHasher
{
	public sealed record Result(long Size, string Crc32, string Md5, string Sha1);

	public static Result HashFile(string path)
	{
		using FileStream fs = File.OpenRead(path);
		long size = fs.Length;
		using var md5 = MD5.Create();
		using var sha1 = SHA1.Create();
		var crc = new Crc32();

		byte[] buffer = ArrayPool<byte>.Shared.Rent(1024 * 1024);
		try
		{
			int read;
			while ((read = fs.Read(buffer, 0, buffer.Length)) > 0)
			{
				md5.TransformBlock(buffer, 0, read, null, 0);
				sha1.TransformBlock(buffer, 0, read, null, 0);
				crc.Append(buffer.AsSpan(0, read));
			}

			md5.TransformFinalBlock([], 0, 0);
			sha1.TransformFinalBlock([], 0, 0);
		}
		finally
		{
			ArrayPool<byte>.Shared.Return(buffer);
		}

		return new Result(
			size,
			crc.Hash.ToString("X8"),
			Convert.ToHexString(md5.Hash!),
			Convert.ToHexString(sha1.Hash!));
	}

	/// <summary>CRC32 IEEE (zip/png).</summary>
	sealed class Crc32
	{
		static readonly uint[] Table = CreateTable();
		uint _crc = 0xFFFFFFFFu;

		public void Append(ReadOnlySpan<byte> data)
		{
			uint c = _crc;
			foreach (byte b in data)
				c = Table[(c ^ b) & 0xFF] ^ (c >> 8);
			_crc = c;
		}

		public uint Hash => ~_crc;

		static uint[] CreateTable()
		{
			var t = new uint[256];
			for (uint i = 0; i < 256; i++)
			{
				uint c = i;
				for (int k = 0; k < 8; k++)
					c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
				t[i] = c;
			}

			return t;
		}
	}
}
