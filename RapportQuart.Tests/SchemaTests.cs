using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;
using Xunit;

namespace RapportQuart.Tests;

/// <summary>Diagnostic : le schéma SQL embarqué dans l'exe s'exécute-t-il, instruction par instruction ?</summary>
public class SchemaTests
{
    [Fact]
    public void Le_schema_embarque_s_execute_instruction_par_instruction()
    {
        using var flux = typeof(Db).Assembly.GetManifestResourceStream("schema.sql");
        Assert.NotNull(flux);
        var sql = new StreamReader(flux).ReadToEnd();
        var sansCommentaires = Regex.Replace(sql, @"--[^\r\n]*", "");

        using var con = new SqliteConnection("Data Source=:memory:");
        con.Open();
        string version;
        using (var v = con.CreateCommand()) { v.CommandText = "SELECT sqlite_version()"; version = (string)v.ExecuteScalar(); }

        int n = 0;
        foreach (var instruction in sansCommentaires.Split(';'))
        {
            if (string.IsNullOrWhiteSpace(instruction)) continue;
            n++;
            try
            {
                using var cmd = con.CreateCommand();
                cmd.CommandText = instruction;
                cmd.ExecuteNonQuery();
            }
            catch (SqliteException ex)
            {
                Assert.Fail($"SQLite {version} : instruction n°{n} en échec : {ex.Message}\n--- instruction ---\n{instruction.Trim()}");
            }
        }
    }
}
