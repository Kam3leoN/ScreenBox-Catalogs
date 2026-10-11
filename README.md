# ScreenBox-Catalogs

Catalogues ROM **SQLite** pour [ScreenBox](https://github.com/Kam3leoN/ScreenBox) — fin Dat-O-Matic / `.dat` runtime.

## Architecture (sans Turso)

La base complète (No-Intro + TOSEC + …) fait **~650 Mo+** : trop grosse pour git et pour Turso (starter).

| Couche | Rôle |
|---|---|
| **Conversion locale** | `ConvertDatsToCatalogDb` → `Systems/_shared/Datas/Catalogs/screenbox-catalogs.db` |
| **GitHub Releases** | Asset `screenbox-catalogs.db` (source de vérité publiée) |
| **Desk** | Sync depuis la dernière Release → dossier Catalogs local |
| **Site Vercel** | Index JSON léger (`systems.json`) pour browse / filtres |

```
DATs locaux → ConvertDatsToCatalogDb → screenbox-catalogs.db
                                         ├─ gh release upload  → Desk sync
                                         └─ npm run export:data:index → site
```

## Contenu dépôt

| Chemin | Rôle |
|---|---|
| `web/` | Site Vercel — K3UI + index `public/data/systems.json` |
| `tools/CatalogEditor/` | Éditeur desktop CRUD (fichier → hash) |
| `.github/workflows/publish-release.yml` | Aide publication Release |
| `screenbox-catalogs.db` | **Non versionné** — publié en Release uniquement |

## Crédits données

Les seeds proviennent des catalogues publics **No-Intro**, **Redump**, **TOSEC**, **MAME**. Respectez leurs licences / conditions d’usage. ScreenBox ne redistribue pas de dumps ROM.

## Desk ScreenBox

**Gestion des catalogues** → télécharge la dernière Release (`screenbox-catalogs.db`) vers  
`Systems/_shared/Datas/Catalogs/`.

## Site

**Production :** [https://screenbox-catalogs.vercel.app](https://screenbox-catalogs.vercel.app)

```powershell
cd web
npm run export:data:index   # systems.json depuis le .db local
npm run build
```

- Sync K3UI : `npm run sync:k3ui`
- Root Vercel : `web/`

## Publier une Release (machine locale)

```powershell
# 1) Convertir les DAT (ScreenBox)
dotnet run --project Core/Scripts/ConvertDatsToCatalogDb -c Release -- --root G:\ScreenBox --no-fullsets

# 2) Copier le snapshot
Copy-Item Systems\_shared\Datas\Catalogs\screenbox-catalogs.db G:\ScreenBox-Catalogs\screenbox-catalogs.db -Force

# 3) Index site + Release
cd G:\ScreenBox-Catalogs\web
npm run export:data:index
cd ..
$tag = "catalogs-$(Get-Date -Format yyyy-MM-dd)"
gh release create $tag screenbox-catalogs.db --title "Catalogs $tag" --notes "Snapshot SQLite (No-Intro + TOSEC + …)"
```

## CatalogEditor

```powershell
cd tools/CatalogEditor
dotnet run -c Release
```

Ouvrir le `.db` local (ou celui synchronisé par Desk).

## Conversion locale (ScreenBox)

```powershell
dotnet run --project Core/Scripts/ConvertDatsToCatalogDb -c Release -- --root G:\ScreenBox
```
