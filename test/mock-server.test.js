// Ende-til-ende: kør scraperen mod en lokal mock af sitet og tjek feeds
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const detaljer = readFileSync(new URL('./fixtures/detaljer.html', import.meta.url), 'utf8');
const img = (n, name) => `https://cdn.prod.website-files.com/x/${String(n).padStart(24, 'a')}_${name}.webp`;
const lb = (urls) => `<script type="application/json" class="w-json">${JSON.stringify({ items: urls.map((url) => ({ url, type: 'image' })), group: 's' })}</script>`;
const page = (body) => `<!doctype html><html><head><meta property="og:image" content=""></head><body><div class="main-wrapper">${body}</div></body></html>`;
const gCard = (n, thumb) => `<div class="w-dyn-item"><div class="layout_card"><img class="card_image" src="${thumb}"><h3>Galleri ${n}</h3><a href="/galleri/galleri-${n}"></a></div></div>`;
const hCard = (slug, navn, thumb) => `<div class="w-dyn-item"><div class="layout_card"><img class="card_image" src="${thumb}"><div class="card-title_wrapper is-outer"><h3>${navn}</h3><div class="card-title_wrapper"><h3>7120</h3><h3>Vejle</h3></div></div><div class="house-card_details-list"><div class="house-card_tag-wrapper"><div>Areal:</div><div>206</div><div>m²</div></div><div class="tag is-text hide">Østjylland</div><div class="tag is-text hide">Arkitekttegnet hus</div></div><a href="/udstillingshuse/${slug}"></a></div><div>Funkishus</div></div>`;
const list = (cards, next) => page(`<div class="w-dyn-list"><div class="card_grid-list w-dyn-items">${cards}</div>${next ? `<a class="w-pagination-next" href="${next}">Next</a>` : ''}</div>`);

const shared = [img(1, 'A'), img(2, 'B'), img(3, 'C'), img(4, 'plantegning')];
const routes = {
  '/galleri': list(gCard(2, img(1, 'A')), '?abc_page=2'),
  '/galleri?abc_page=2': list(gCard(1, img(9, 'Z'))),
  '/galleri/galleri-2': page(`<h1>Galleri 2</h1><section class="section_simple-text"><div class="w-richtext"><p><strong>Overskrift</strong></p><p><strong>Mursten:</strong> X <strong>Bolig:</strong> 206 m<sup>2</sup></p><p>Beskrivelse</p></div></section>${lb(shared)}`),
  '/galleri/galleri-1': page(`<h1>Galleri 1</h1><section class="section_simple-text"><div class="w-richtext"><p>Tekst</p></div></section>${lb([img(9, 'Z')])}`),
  '/udstillingshuse': list(hCard('margrethehoj-24', 'Margrethehøj 24', img(1, 'A'))),
  '/udstillingshuse/margrethehoj-24': page(`<h1>Et hus</h1><div class="udstillingshus-hero_tag"><div>Margrethehøj 24, 7120 Vejle</div></div><div class="udstillingshus-hero_tag"><div>Huset er til salg - Pris: 6.995.000,-</div></div>${detaljer}${lb(shared)}`),
};
const server = http.createServer((req, res) => {
  const body = routes[req.url];
  res.writeHead(body ? 200 : 404, { 'content-type': 'text/html' });
  res.end(body || 'nope');
});
await new Promise((r) => server.listen(0, r));
const out = mkdtempSync(path.join(tmpdir(), 'feeds-'));
try {
  // Sikkerhedsnettet (min. 10 gallerier) skal stoppe kørslen og ikke skrive noget
  let failed = false;
  try {
    await run('node', ['src/scrape.js', out], { env: { ...process.env, HYBEL_BASE: `http://localhost:${server.address().port}`, DELAY_MS: '0' } });
  } catch (e) {
    failed = /For få elementer/.test(String(e.stderr));
  }
  assert.ok(failed, 'sikkerhedsnet slog ikke til');

  await run('node', ['src/scrape.js', out], { env: { ...process.env, HYBEL_BASE: `http://localhost:${server.address().port}`, DELAY_MS: '0', MIN_GALLERIER: '1', MIN_HUSE: '1' } });
  const g = JSON.parse(readFileSync(path.join(out, 'galleri.json'), 'utf8'));
  const h = JSON.parse(readFileSync(path.join(out, 'udstillingshuse.json'), 'utf8'));
  assert.equal(g.meta.antal, 2);
  const g2 = g.items.find((x) => x.id === 'galleri-2');
  assert.equal(g2.overskrift, 'Overskrift');
  assert.deepEqual(g2.arealer_m2, { bolig: 206 });
  assert.equal(g2.plantegninger.length, 1);
  assert.equal(g2.udstillingshus_id, 'margrethehoj-24');
  const hus = h.items[0];
  assert.equal(hus.pris_dkk, 6995000);
  assert.equal(hus.detaljer.felter.grund_m2, 990);
  assert.equal(hus.galleri_id, 'galleri-2');
  assert.equal(hus.region, 'Østjylland');
  console.log('Ende-til-ende-test bestået');
} finally {
  server.close();
}
