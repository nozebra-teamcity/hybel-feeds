# Hybel-feeds

Henter automatisk alle gallerier fra hybelhuse.dk/galleri og alle udstillingshuse (inkl. sektionen **Detaljer**) fra hybelhuse.dk/udstillingshuse og publicerer dem som to JSON-feeds, der opdateres hver nat.

| Feed | Indhold |
|---|---|
| `galleri.json` | Alle gallerier (230 pr. 30/10 2026) med overskrift, beskrivelse, materialer, arealer, billeder og plantegninger |
| `udstillingshuse.json` | Alle udstillingshuse (28 pr. 30/10 2026) med kortdata, åbningstider, salgspris, **Detaljer**, billeder og plantegninger |

De to feeds er koblet sammen: når et galleri og et udstillingshus er samme hus (de deler billedfiler), står det i `udstillingshus_id` / `galleri_id`.

## Opsætning (ca. 10 minutter, gratis)

1. Opret et nyt GitHub-repository og læg indholdet af denne mappe i det.
2. Gå til **Settings → Pages** og vælg **Source: GitHub Actions**.
3. Gå til **Actions → Opdatér Hybel-feeds → Run workflow** for første kørsel.
4. Feeds ligger herefter på
   `https://<org>.github.io/<repo>/galleri.json` og
   `https://<org>.github.io/<repo>/udstillingshuse.json`

Feeds opdateres hver nat kl. 04:17 UTC og kan til enhver tid opdateres manuelt via **Run workflow**. GitHub Pages sender CORS-headere, så feeds kan hentes direkte fra browser, Lovable, n8n m.m.

## Lokal kørsel

```bash
npm install
npm test          # parser-tests + ende-til-ende-test mod en mock af sitet
npm run scrape    # skriver public/galleri.json og public/udstillingshuse.json
```

En kørsel tager typisk 2-4 minutter (ca. 300 sider, 4 samtidige forespørgsler med pause imellem). Kan justeres med `CONCURRENCY` og `DELAY_MS`.

## Feltoversigt

**Galleri** (`items[]`)

| Felt | Eksempel |
|---|---|
| `id`, `nummer`, `titel`, `url` | `galleri-229`, `229`, `Galleri 229` |
| `overskrift` | `Et funkishus med plads til både fællesskab, frirum og lange bade` |
| `beskrivelse` | Brødteksten |
| `materialer` | `{ "mursten": "RT 547 Helios", "klinker": "…", "gulv": "…" }` |
| `arealer_m2` | `{ "bolig": 199, "carport": 54 }` (også `garage` m.fl.) |
| `thumbnail`, `billeder[]`, `plantegninger[]`, `antal_billeder` | Fulde CDN-URL'er |
| `udstillingshus_id` | `uglebakken-2` eller `null` |

**Udstillingshus** (`items[]`)

| Felt | Eksempel |
|---|---|
| `id`, `url`, `navn`, `postnr`, `by`, `adresse_fuld` | `Uglebakken 2`, `4140`, `Borup` |
| `region`, `hustype`, `tagkonstruktion` | `Sjælland`, `Arkitekttegnet hus`, `Funkishus` |
| `aabningstider`, `areal_m2`, `vaerelser` | `Huset har åbent hver søndag kl. 13-15`, `199`, `4` |
| `til_salg`, `pris`, `pris_dkk` | `true`, `6.995.000,-`, `6995000` |
| `overskrift`, `beskrivelse` | Sidens H1 og meta-beskrivelse |
| `detaljer.felter` | Hele Detaljer-sektionen som nøgle/værdi: `hustype`, `antal_vaerelser`, `areal_bolig_grund`, `bolig_m2`, `grund_m2`, `overdaekket_terrasse`, `garage`/`carport`, `tag`, `mursten`, `klinker`, `gulve`, `vinduer`, `tagkonstruktion`, `varmekilde`, `lca_vaerdi` |
| `detaljer.liste` | Samme data i visningsrækkefølge med originale labels |
| `detaljer.intro`, `detaljer.fodnote` | Introtekst og LCA-fodnoten |
| `kort_url`, `coverbillede`, `billeder[]`, `plantegninger[]` | |
| `galleri_id` | `galleri-229` eller `null` |

Begge feeds har `meta.genereret` (tidspunkt for seneste kørsel) og `meta.antal`.

## Sikkerhedsnet

- Finder scraperen under 10 gallerier eller 3 huse, eller fejler over 10 % af detaljesiderne, stopper den uden at skrive noget. Workflowet fejler, og de sidst publicerede feeds bliver liggende. GitHub sender en mail ved fejl.
- Enkeltsider, der fejler, får et `fejl`-felt i stedet for at vælte hele kørslen.

## Vedligehold

Al parsing ligger i `src/parse.js` og bygger på Webflow-klasserne på hybelhuse.dk (`card_grid-list`, `hus-detalje-grid_item`, `gallery-image_item` m.fl.). Ændrer Hybel deres skabeloner, er det her, der skal rettes. Billedlisterne hentes fra Webflow-lightboxens JSON, som indeholder det fulde billedsæt (karrusellen viser kun 25).

Kendte forhold i data (pr. 30/10 2026):
- En del ældre gallerier har ingen separat overskrift - første sætning ligger i stedet i `beskrivelse`.
- `galleri-20` angiver ikke boligareal i teksten.
- 8 af 28 udstillingshuse har et tilhørende galleri.
