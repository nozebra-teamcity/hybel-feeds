// Parsere til hybelhuse.dk (Webflow). Bruger kun standard DOM-API, så samme kode
// kører i Node (linkedom) og i en browser (DOMParser).

export const BASE = globalThis.process?.env?.HYBEL_BASE || 'https://hybelhuse.dk';

const REGIONER = [
  'Sjælland',
  'Fyn',
  'Syd- og Sønderjylland',
  'Østjylland',
  'Midtjylland',
  'Nordjylland',
  'Vestjylland',
  'Bornholm',
];

const clean = (s) =>
  (s || '')
    .replace(/[\u00a0\u200b\u2060\ufeff]/g, ' ')
    .replace(/[\u200c\u200d\u00ad]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// textContent, men <br> inde i et element bliver til mellemrum
const textOf = (n) => {
  if (n.nodeType === 3) return n.textContent;
  if (n.nodeType !== 1) return '';
  if (n.tagName === 'BR') return ' ';
  return [...n.childNodes].map(textOf).join('');
};
const abs = (href) => (href ? new URL(href, BASE).href : null);
const visible = (el) => !!el && !el.closest('.w-condition-invisible');

export function slugKey(label) {
  return clean(label)
    .toLowerCase()
    .replace(/:$/, '')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'oe')
    .replace(/å/g, 'aa')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

const toNumber = (s) => {
  const m = clean(s).match(/-?\d+(?:[.,]\d+)?/);
  return m ? Number(m[0].replace(',', '.')) : null;
};

// Webflow asset-id (24 hex) fra et CDN-filnavn - bruges til at koble galleri og udstillingshus
export function assetId(url) {
  const m = (url || '').match(/\/([0-9a-f]{24})_/);
  return m ? m[1] : null;
}

const uniq = (arr) => [...new Set(arr.filter(Boolean))];

// Webflow-lightboxen gemmer det fulde billedsæt som JSON i <script class="w-json">.
// Det er den mest komplette kilde (karrusellen viser maks. 25 billeder).
// Kort for andre huse/gallerier (.layout_card) springes over.
export function lightboxImages(doc) {
  const urls = [];
  for (const s of doc.querySelectorAll('script.w-json')) {
    if (s.closest('.layout_card')) continue;
    try {
      for (const it of JSON.parse(s.textContent).items || []) {
        if ((it.type || 'image') === 'image' && it.url) urls.push(abs(it.url));
      }
    } catch {
      /* ugyldig JSON - ignorér */
    }
  }
  return uniq(urls);
}

const isPlantegning = (u) => /plantegning/i.test(decodeURIComponent(u));

// Paginering: Webflow bruger relative links som ?<hash>_page=N - løses mod den aktuelle side
export function nextPageUrl(doc, listSelector, currentUrl) {
  const list = doc.querySelector(listSelector);
  const scope = list ? list.closest('.w-dyn-list') || doc : doc;
  const a = scope.querySelector('.w-pagination-next') || doc.querySelector('.w-pagination-next');
  return a ? new URL(a.getAttribute('href'), currentUrl).href : null;
}

/* ---------- Galleri: rich text (overskrift, materialer, beskrivelse, arealer) ---------- */

// Galleri-teksterne findes i flere generationer af markup, fx:
//   <p><strong>Mursten:&nbsp;</strong>RT 547 ...  <strong>Bolig:</strong> 199 m<sup>2</sup></p>   (nye)
//   <p><strong>Overskrift.</strong><br><strong>Mursten</strong>: Libra. <strong>Gulv</strong>: ...</p> (ældre)
// Derfor splittes hvert <p> i linjer ved <br>, og en "label" er en <strong>, der enten slutter
// med ":" eller efterfølges af tekst, der starter med ":".

const LABEL_ALIAS = { caport: 'carport', gulve: 'gulv', klinke: 'klinker' };
const KNOWN_LABEL_END = /^(.*?\S)\s+(Mursten|Klinker|Klinke|Gulve?|Bolig|Garage|Carport|Caport)$/i;
// Arealer udtrækkes fra den samlede tekst, så også "Bolig: 210 m2 Garage 58 m2" og "173, m2" fanges
const AREA_SCAN =
  /(Bolig|Garage|Carport|Caport|Overdækket (?:areal|terrasse)|Udestue|Udhus|Skur|Kælder)\s*:?\s*(\d+(?:[.,]\d+)?)\s*,?\s*m\s*(?:2|²)/gi;
const AREA_RE = /^(\d+(?:[.,]\d+)?)\s*m\s*(2|²)\.?$/i;
const isStrong = (n) => n.nodeType === 1 && (n.tagName === 'STRONG' || n.tagName === 'B');

function linesOf(p) {
  const lines = [[]];
  for (const n of p.childNodes) {
    if (n.nodeType === 1 && n.tagName === 'BR') lines.push([]);
    else lines[lines.length - 1].push({ strong: isStrong(n), text: textOf(n) });
  }
  return lines.filter((l) => clean(l.map((t) => t.text).join('')));
}

function parseLine(tokens) {
  const pairs = [];
  const pre = [];
  let preAllStrong = true;
  let cur = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.strong) {
      const txt = clean(t.text);
      const next = tokens[i + 1];
      let label = null;
      if (/:$/.test(txt)) label = txt.replace(/:$/, '');
      else if (next && !next.strong && /^\s*:/.test(next.text)) {
        label = txt;
        tokens[i + 1] = { ...next, text: next.text.replace(/^\s*:/, '') };
      }
      if (label !== null) {
        // "Overskrift. Mursten:" / "Vinkelhus med fladt tag Mursten:" i samme <strong> - del dem
        const m = label.match(KNOWN_LABEL_END) || label.match(/^(.*[.!?])\s+([^.!?]{1,30})$/);
        if (m) {
          pre.push(m[1]);
          label = m[2];
        }
        cur = { label: clean(label), value: '' };
        pairs.push(cur);
        continue;
      }
    }
    if (cur) cur.value += t.text;
    else {
      pre.push(t.text);
      if (!t.strong && clean(t.text)) preAllStrong = false;
    }
  }
  return {
    pre: clean(pre.join(' ')),
    preAllStrong,
    pairs: pairs
      .map((x) => ({ label: x.label, value: clean(x.value).replace(/[.,;]\s*$/, '') }))
      .filter((x) => x.label),
  };
}

export function parseGalleryRichText(rich) {
  const out = { overskrift: null, materialer: {}, arealer_m2: {}, beskrivelse: null };
  if (!rich) return out;
  const beskrivelse = [];
  for (const p of rich.querySelectorAll('p')) {
    for (const line of linesOf(p)) {
      const { pre, preAllStrong, pairs } = parseLine(line);
      if (pre) {
        if (!out.overskrift && preAllStrong) out.overskrift = pre;
        else beskrivelse.push(pre);
      }
      for (const { label, value } of pairs) {
        let key = slugKey(label);
        key = LABEL_ALIAS[key] || key;
        if (AREA_RE.test(value)) out.arealer_m2[key] = toNumber(value);
        else if (value) out.materialer[key] = value;
      }
    }
  }
  const plain = clean([...rich.querySelectorAll('p')].map((p) => p.textContent).join(' '));
  for (const m of plain.matchAll(AREA_SCAN)) {
    const key = LABEL_ALIAS[slugKey(m[1])] || slugKey(m[1]);
    if (out.arealer_m2[key] == null) out.arealer_m2[key] = toNumber(m[2]);
  }
  for (const k of Object.keys(out.materialer)) {
    if (/\d\s*,?\s*m\s*(2|²)/i.test(out.materialer[k])) delete out.materialer[k];
  }
  out.beskrivelse = beskrivelse.join('\n\n') || null;
  return out;
}

/* ---------- Galleri: oversigtsside ---------- */

export function parseGalleryListPage(doc) {
  return [...doc.querySelectorAll('.card_grid-list > .w-dyn-item')]
    .map((item) => {
      const link = [...item.querySelectorAll('a[href]')].find((a) => /\/galleri\/[^/?#]+/.test(a.getAttribute('href')));
      if (!link) return null;
      const url = abs(link.getAttribute('href'));
      return {
        id: url.split('/').pop(),
        url,
        titel: clean(item.querySelector('h3')?.textContent),
        thumbnail: abs(item.querySelector('img.card_image')?.getAttribute('src')),
      };
    })
    .filter(Boolean);
}

/* ---------- Galleri: detaljeside ---------- */

export function parseGalleryDetail(doc, url) {
  const titel = clean(doc.querySelector('h1')?.textContent);
  const rich =
    doc.querySelector('.section_simple-text .w-richtext') ||
    doc.querySelector('main .w-richtext, .main-wrapper .w-richtext');
  const text = parseGalleryRichText(rich);
  const alle = uniq([
    ...lightboxImages(doc),
    ...[...doc.querySelectorAll('.gallery-image_item img')].map((i) => abs(i.getAttribute('src'))),
  ]);
  const plantegninger = alle.filter(isPlantegning);
  return {
    id: url.split('/').pop(),
    url,
    titel,
    nummer: toNumber(titel),
    ...text,
    billeder: alle.filter((u) => !plantegninger.includes(u)),
    plantegninger,
    antal_billeder: alle.length,
    og_image: doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || null,
  };
}

/* ---------- Udstillingshuse: oversigtsside ---------- */

export function parseShowHouseListPage(doc) {
  return [...doc.querySelectorAll('.card_grid-list > .w-dyn-item')]
    .map((item) => {
      const link = [...item.querySelectorAll('a[href]')].find((a) =>
        /\/udstillingshuse\/[^/?#]+/.test(a.getAttribute('href')),
      );
      if (!link) return null;
      const url = abs(link.getAttribute('href'));
      const [navn, postnr, by] = [...item.querySelectorAll('.card-title_wrapper h3')].map((h) => clean(h.textContent));

      // Tag-rækker: "Åbningstider:", "Areal:", "Værelser:"
      const felter = {};
      for (const w of item.querySelectorAll('.house-card_tag-wrapper')) {
        if (!visible(w)) continue;
        const parts = [...w.children].map((c) => clean(c.textContent)).filter(Boolean);
        if (parts.length > 1) felter[slugKey(parts[0])] = parts.slice(1).join(' ');
      }

      const loseTags = [...item.querySelectorAll('.house-card_details-list > .tag')].filter(visible).map((t) => ({
        text: clean(t.textContent),
        skjult: t.classList.contains('hide'),
      }));
      const skjulte = loseTags.filter((t) => t.skjult).map((t) => t.text);
      const region = skjulte.find((t) => REGIONER.includes(t)) || null;
      const hustype = skjulte.find((t) => t !== region) || null;

      // Tagkonstruktion står som filterfelt uden for kortet
      const tagkonstruktion =
        [...item.querySelectorAll('div')]
          .filter((d) => !d.closest('.layout_card') && d.children.length === 0 && visible(d))
          .map((d) => clean(d.textContent))
          .find((t) => /tag|funkis/i.test(t)) || null;
      return {
        id: url.split('/').pop(),
        url,
        navn,
        postnr: postnr || null,
        by: by || null,
        region,
        hustype,
        tagkonstruktion,
        aabningstider: felter.aabningstider || null,
        areal_m2: toNumber(felter.areal),
        vaerelser: toNumber(felter.vaerelser),
        til_salg: loseTags.some((t) => !t.skjult && /til salg/i.test(t.text)),
        kort_url: item.querySelector('a.vis-rutevejledning')?.getAttribute('href') || null,
        coverbillede: abs(item.querySelector('img.card_image')?.getAttribute('src')),
      };
    })
    .filter(Boolean);
}

/* ---------- Udstillingshuse: detaljeside inkl. "Detaljer" ---------- */

export function parseDetaljer(root) {
  const items = [];
  for (const it of root.querySelectorAll('.hus-detalje-grid_item')) {
    const label = clean(it.querySelector('.text-size-medium')?.textContent);
    const inner = it.querySelector('.hus-detaljer_inner-inner');
    if (!label || !inner) continue;
    // Hver .hus-detalje_indhold-inner er én værdi; dens børn samles med mellemrum ("206 m²")
    const dele = [...inner.querySelectorAll('.hus-detalje_indhold-inner')].map((v) =>
      clean([...v.children].map((c) => c.textContent).join(' ') || v.textContent),
    );
    const vaerdi = clean(dele.join(' ')).replace(/^\/\s*/, '');
    items.push({ label, noegle: slugKey(label), vaerdi, ikon: abs(it.querySelector('img')?.getAttribute('src')) });
  }

  const felter = Object.fromEntries(items.map((i) => [i.noegle, i.vaerdi]));
  const areal = felter.areal_bolig_grund;
  if (areal) {
    const [bolig, grund] = areal.split('/').map(toNumber);
    felter.bolig_m2 = bolig ?? null;
    felter.grund_m2 = grund ?? null;
  }
  const scope = root.closest('.padding-section-small') || root;
  return {
    intro: clean(scope.querySelector('._2-col_grid-wrap .w-embed')?.textContent) || null,
    felter,
    liste: items.map(({ label, noegle, vaerdi }) => ({ label, noegle, vaerdi })),
    fodnote: clean(scope.querySelector('.text-style-italic')?.textContent) || null,
  };
}

export function parseShowHouseDetail(doc, url) {
  const heroTags = [...doc.querySelectorAll('.udstillingshus-hero_tag')]
    .filter((t) => visible(t) && !t.classList.contains('is-lightbox'))
    .map((t) => clean(t.textContent))
    .filter(Boolean);
  const salg = heroTags.find((t) => /til salg/i.test(t)) || null;
  const pris = salg && salg.match(/pris:\s*(.+)$/i);

  const detaljerRoot = doc.querySelector('.hus-detaljer_component');
  const alle = uniq([
    abs(doc.querySelector('.case-featured_hero img')?.getAttribute('src')),
    ...lightboxImages(doc),
    ...[...doc.querySelectorAll('.section_karousel .w-dyn-item img')].map((i) => abs(i.getAttribute('src'))),
  ]);
  const plantegninger = alle.filter(isPlantegning);
  const prisTekst = pris ? clean(pris[1]) : null;

  return {
    id: url.split('/').pop(),
    url,
    overskrift: clean(doc.querySelector('h1')?.textContent) || null,
    adresse_fuld: heroTags.find((t) => /\d{4}/.test(t) && !/til salg/i.test(t)) || null,
    salgstekst: salg,
    pris: prisTekst,
    pris_dkk: prisTekst ? Number(prisTekst.replace(/[^\d]/g, '')) || null : null,
    beskrivelse: doc.querySelector('meta[name="description"]')?.getAttribute('content') || null,
    detaljer: detaljerRoot ? parseDetaljer(detaljerRoot) : null,
    billeder: alle.filter((u) => !plantegninger.includes(u)),
    plantegninger,
    antal_billeder: alle.length,
    og_image: doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || null,
  };
}

/* ---------- Samling af de to feeds ---------- */

export function buildFeeds({ galleryList, galleryDetails, houseList, houseDetails, generatedAt }) {
  const gDetail = new Map(galleryDetails.map((d) => [d.id, d]));
  const hDetail = new Map(houseDetails.map((d) => [d.id, d]));

  // Kobling: et galleri og et udstillingshus bruger de samme billedfiler (Webflow asset-id).
  // Huset kobles til det galleri, det deler flest billeder med (mindst 3).
  const assetsOf = (urls) => new Set(urls.map(assetId).filter(Boolean));
  const houseAssets = houseList.map((h) => {
    const d = hDetail.get(h.id) || {};
    return { id: h.id, set: assetsOf([h.coverbillede, ...(d.billeder || []), ...(d.plantegninger || [])]) };
  });
  const houseForGallery = (g, d) => {
    const gs = assetsOf([g.thumbnail, ...(d.billeder || []), ...(d.plantegninger || [])]);
    let best = null;
    let bestN = 0;
    for (const h of houseAssets) {
      let n = 0;
      for (const a of gs) if (h.set.has(a)) n++;
      if (n > bestN) [best, bestN] = [h.id, n];
    }
    // 3+ fælles billeder, eller samme coverbillede som eneste fællesnævner
    const thumbShared = best && houseAssets.find((h) => h.id === best).set.has(assetId(g.thumbnail));
    return bestN >= 3 || thumbShared ? best : null;
  };

  const galleri = galleryList.map((g) => {
    const d = gDetail.get(g.id) || {};
    const udstillingshus = houseForGallery(g, d);
    return {
      id: g.id,
      nummer: d.nummer ?? null,
      titel: d.titel || g.titel,
      url: g.url,
      overskrift: d.overskrift ?? null,
      beskrivelse: d.beskrivelse ?? null,
      materialer: d.materialer || {},
      arealer_m2: d.arealer_m2 || {},
      thumbnail: g.thumbnail,
      billeder: d.billeder || [],
      plantegninger: d.plantegninger || [],
      antal_billeder: d.antal_billeder ?? 0,
      udstillingshus_id: udstillingshus,
      fejl: d.fejl || undefined,
    };
  });

  const galleryByHouse = new Map(galleri.filter((g) => g.udstillingshus_id).map((g) => [g.udstillingshus_id, g.id]));

  const udstillingshuse = houseList.map((h) => {
    const d = hDetail.get(h.id) || {};
    return {
      ...h,
      overskrift: d.overskrift ?? null,
      adresse_fuld: d.adresse_fuld ?? null,
      salgstekst: d.salgstekst ?? null,
      pris: d.pris ?? null,
      pris_dkk: d.pris_dkk ?? null,
      beskrivelse: d.beskrivelse ?? null,
      detaljer: d.detaljer || null,
      billeder: d.billeder || [],
      plantegninger: d.plantegninger || [],
      antal_billeder: d.antal_billeder ?? 0,
      galleri_id: galleryByHouse.get(h.id) || null,
      fejl: d.fejl || undefined,
    };
  });

  const meta = (n, kilde) => ({ kilde, genereret: generatedAt, antal: n });
  return {
    galleri: { meta: meta(galleri.length, `${BASE}/galleri`), items: galleri },
    udstillingshuse: { meta: meta(udstillingshuse.length, `${BASE}/udstillingshuse`), items: udstillingshuse },
  };
}
