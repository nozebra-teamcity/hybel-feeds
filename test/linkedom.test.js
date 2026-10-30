import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import assert from 'node:assert/strict';
import {
  parseDetaljer,
  parseGalleryRichText,
  nextPageUrl,
  lightboxImages,
  parseShowHouseListPage,
} from '../src/parse.js';

const doc = (html) => parseHTML(`<!doctype html><html><body>${html}</body></html>`).document;

// 1) Detaljer-blokken (rå markup fra udstillingshus-siden)
const det = doc(readFileSync(new URL('./fixtures/detaljer.html', import.meta.url), 'utf8'));
const d = parseDetaljer(det.querySelector('.hus-detaljer_component'));
assert.equal(d.felter.areal_bolig_grund, '206 m² / 990 m²');
assert.equal(d.felter.bolig_m2, 206);
assert.equal(d.felter.grund_m2, 990);
assert.equal(d.felter.garage, '55 m²');
assert.equal(d.felter.lca_vaerdi, '6,5 Kg CO2 eq./m2/år*');
assert.equal(d.liste.length, 13);
assert.match(d.intro, /Margrethehøj 24/);
assert.match(d.fodnote, /LCA-værdien/);

// 2) Rich text-varianter fra galleriet
const rt = (h) => parseGalleryRichText(doc(`<div class="w-richtext">${h}</div>`).querySelector('.w-richtext'));
let r = rt(
  `<p><strong>Et funkishus</strong></p><p><strong>Mursten:&nbsp;</strong>RT 547 Helios <strong>Klinker:</strong>&nbsp;Pamesa <strong>Gulv:</strong>&nbsp;Hybel 300</p><p>Funkishus med jordvarme.</p><p><strong>Bolig:</strong>&nbsp;199 m<sup>2</sup> <strong>Carport:</strong>&nbsp;54 m<sup>2</sup></p>`,
);
assert.deepEqual(r, {
  overskrift: 'Et funkishus',
  materialer: { mursten: 'RT 547 Helios', klinker: 'Pamesa', gulv: 'Hybel 300' },
  arealer_m2: { bolig: 199, carport: 54 },
  beskrivelse: 'Funkishus med jordvarme.',
});
r = rt(
  `<p><strong>Forskudt vinkelhus.</strong><br><strong>Mursten</strong>: Libra. <strong>Klinker</strong>: Essay. <strong>Gulv</strong>: Laminat 86</p><p>Lys entré</p><p><strong>Bolig</strong>: 185 m<sup>2</sup>. <strong>Caport</strong>: 48 m2.</p>`,
);
assert.equal(r.overskrift, 'Forskudt vinkelhus.');
assert.deepEqual(r.materialer, { mursten: 'Libra', klinker: 'Essay', gulv: 'Laminat 86' });
assert.deepEqual(r.arealer_m2, { bolig: 185, carport: 48 });
r = rt(
  `<p><strong>H-hus med saddeltag uden udhæng<br>Mursten:</strong> Sisteron <strong>Klinke:</strong> Ragno</p><p><strong>Bolig:</strong> 210 m2 Garage 58 m2</p>`,
);
assert.equal(r.overskrift, 'H-hus med saddeltag uden udhæng');
assert.deepEqual(r.materialer, { mursten: 'Sisteron', klinker: 'Ragno' });
assert.deepEqual(r.arealer_m2, { bolig: 210, garage: 58 });

// 3) Paginering løses mod aktuel side
const pg = doc(
  `<div class="w-dyn-list"><div class="card_grid-list w-dyn-items"></div><a class="w-pagination-next" href="?189eccf0_page=2">Next</a></div>`,
);
assert.equal(
  nextPageUrl(pg, '.card_grid-list', 'https://hybelhuse.dk/galleri'),
  'https://hybelhuse.dk/galleri?189eccf0_page=2',
);

// 4) Lightbox-JSON
const lb = doc(
  `<script type="application/json" class="w-json">{"items":[{"url":"https://cdn.x/a.webp","type":"image"},{"url":"https://cdn.x/a.webp","type":"image"}],"group":"s"}</script>`,
);
assert.deepEqual(lightboxImages(lb), ['https://cdn.x/a.webp']);

// 5) Kort på udstillingshus-oversigt (condition-invisible + skjulte tags)
const card = doc(
  `<div class="card_grid-list"><div class="w-dyn-item"><div class="layout_card"><img class="card_image" src="https://cdn.x/6a15f84ced741b91bf465e38_U.webp"><a class="vis-rutevejledning" href="https://maps.app.goo.gl/x"></a><div class="card-title_wrapper is-outer"><h3>Uglebakken 2</h3><div class="card-title_wrapper"><h3>4140</h3><h3>Borup</h3></div></div><div class="house-card_details-list"><div class="house-card_tag-wrapper"><div class="tag">Areal:</div><div>199</div><div>m²</div></div><div class="house-card_tag-wrapper"><div class="tag">Værelser:</div><div>4</div></div><div class="tag is-text w-condition-invisible">Huset er til salg</div><div class="tag is-text hide">Sjælland</div><div class="tag is-text hide">Arkitekttegnet hus</div></div><a href="/udstillingshuse/uglebakken-2"></a></div><div>Funkishus</div></div></div>`,
);
const [h] = parseShowHouseListPage(card);
assert.equal(h.navn, 'Uglebakken 2');
assert.equal(h.areal_m2, 199);
assert.equal(h.vaerelser, 4);
assert.equal(h.til_salg, false);
assert.equal(h.region, 'Sjælland');
assert.equal(h.hustype, 'Arkitekttegnet hus');
assert.equal(h.tagkonstruktion, 'Funkishus');
console.log('Alle linkedom-tests bestået');

// 6) "Overskrift. Mursten : værdi" (label + kolon uden for <strong>)
{
  const { parseGalleryRichText: prt } = await import('../src/parse.js');
  const d2 = parseHTML(
    `<div class="w-richtext"><p><strong>Forskudt vinkelhus med saddeltag uden udhæng. Mursten</strong> : Silver Grey. <strong>Klinker:</strong> V&amp;B</p></div>`,
  ).document;
  const r2 = prt(d2.querySelector('.w-richtext'));
  assert.equal(r2.overskrift, 'Forskudt vinkelhus med saddeltag uden udhæng.');
  assert.deepEqual(r2.materialer, { mursten: 'Silver Grey', klinker: 'V&B' });
}

// 7) Kobling galleri <-> udstillingshus via fælles billeder
{
  const { buildFeeds } = await import('../src/parse.js');
  const img = (n) => `https://cdn.x/${String(n).padStart(24, 'a')}_x.webp`;
  const f = buildFeeds({
    galleryList: [
      { id: 'galleri-1', url: 'u', titel: 'Galleri 1', thumbnail: img(1) },
      { id: 'galleri-2', url: 'u2', titel: 'Galleri 2', thumbnail: img(9) },
    ],
    galleryDetails: [
      { id: 'galleri-1', billeder: [img(2), img(3), img(4)] },
      { id: 'galleri-2', billeder: [img(8)] },
    ],
    houseList: [{ id: 'hus-a', coverbillede: img(5) }],
    houseDetails: [{ id: 'hus-a', billeder: [img(2), img(3), img(4)] }],
    generatedAt: 'x',
  });
  assert.equal(f.galleri.items[0].udstillingshus_id, 'hus-a');
  assert.equal(f.galleri.items[1].udstillingshus_id, null);
  assert.equal(f.udstillingshuse.items[0].galleri_id, 'galleri-1');
}
console.log('Ekstra tests bestået');
