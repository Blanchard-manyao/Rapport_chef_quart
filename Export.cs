using System.Globalization;
using System.IO.Compression;
using System.Security;
using System.Text;

namespace RapportQuart;

/// <summary>Écrit un vrai fichier .xlsx (une feuille) sans bibliothèque externe.</summary>
public static class ExcelMini
{
    public static void Ecrire(string chemin, string feuille, string[] entetes, List<object[]> lignes)
    {
        if (File.Exists(chemin)) File.Delete(chemin);
        using var zip = ZipFile.Open(chemin, ZipArchiveMode.Create);

        Ajouter(zip, "[Content_Types].xml",
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
            "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
            "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
            "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>" +
            "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>" +
            "</Types>");

        Ajouter(zip, "_rels/.rels",
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
            "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>" +
            "</Relationships>");

        Ajouter(zip, "xl/workbook.xml",
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" " +
            "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">" +
            $"<sheets><sheet name=\"{SecurityElement.Escape(feuille)}\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>");

        Ajouter(zip, "xl/_rels/workbook.xml.rels",
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
            "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>" +
            "</Relationships>");

        var sb = new StringBuilder();
        sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
        sb.Append("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>");
        EcrireLigne(sb, 1, entetes.Cast<object>().ToArray());
        for (int i = 0; i < lignes.Count; i++) EcrireLigne(sb, i + 2, lignes[i]);
        sb.Append("</sheetData></worksheet>");
        Ajouter(zip, "xl/worksheets/sheet1.xml", sb.ToString());
    }

    static void EcrireLigne(StringBuilder sb, int numero, object[] valeurs)
    {
        sb.Append($"<row r=\"{numero}\">");
        for (int i = 0; i < valeurs.Length; i++)
        {
            string ref_ = $"{(char)('A' + i)}{numero}";
            var v = valeurs[i];
            if (v == null) continue;
            if (v is long or int or short or decimal or double)
                sb.Append($"<c r=\"{ref_}\"><v>{Convert.ToString(v, CultureInfo.InvariantCulture)}</v></c>");
            else
                sb.Append($"<c r=\"{ref_}\" t=\"inlineStr\"><is><t>{SecurityElement.Escape(Convert.ToString(v, CultureInfo.InvariantCulture))}</t></is></c>");
        }
        sb.Append("</row>");
    }

    static void Ajouter(ZipArchive zip, string nom, string contenu)
    {
        var entree = zip.CreateEntry(nom);
        using var w = new StreamWriter(entree.Open(), new UTF8Encoding(false));
        w.Write(contenu);
    }
}