# ScreenBox-Catalogs

Catalogues ROM **SQLite** pour [ScreenBox](https://github.com/Kam3leoN/ScreenBox) — fin Dat-O-Matic / `.dat` runtime.

## Contenu

| Chemin | Rôle |
|---|---|
| `screenbox-catalogs.db` | Snapshot publié (sync Desk) |
| `tools/CatalogEditor/` | Éditeur desktop CRUD (fichier → hash) |
| `web/` | Site Vercel — K3UI Material You 3 Expressive + Turso |
| `fullsets/` | Extraits optionnels par système |
| `.github/workflows/export-snapshot.yml` | Dump Turso → commit `.db` |

## Crédits données

Les seeds proviennent des catalogues publics **No-Intro**, **Redump**, **TOSEC**, **MAME**. Respectez leurs licences / conditions d’usage. ScreenBox ne redistribue pas de dumps ROM.

## Desk ScreenBox

**Gestion des catalogues** → synchronise `screenbox-catalogs.db` depuis ce dépôt vers  
`Systems/_shared/Datas/Catalogs/`.

## Site

- Stack : Vite + TypeScript + [K3UI](https://github.com/Kam3leoN/K3ui) (Material You 3 Expressive)
- Docs UI : [k3ui-docs.vercel.app](https://k3ui-docs.vercel.app)
- Sync K3UI : `cd web && npm run sync:k3ui` (repo K3ui sibling ou `K3UI_ROOT`)
- Secrets Vercel : `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, OAuth GitHub pour CRUD

## CatalogEditor

```powershell
cd tools/CatalogEditor
dotnet run -c Release
```

Ouvrir `screenbox-catalogs.db` → système → **Sélectionner fichier ROM** → créer l’entrée.

## Conversion locale (ScreenBox)

```powershell
dotnet run --project Core/Scripts/ConvertDatsToCatalogDb -c Release -- --root G:\ScreenBox
```
