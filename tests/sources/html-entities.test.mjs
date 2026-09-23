// node --test tests/  — décodage des entités HTML dans les offres collectées.
// Bug réel constaté sur l'offre EWOR : "Paul M&uuml;ller (founder of Adjust,
// &euro;1.2B exit)" jamais décodé dans la description affichée côté app iOS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntitesHtml } from '../../scraping/html-entities.mjs';
import { clean } from '../../scraping/sources/index.mjs';

test('décode le cas réel EWOR (lettres accentuées + euro)', () => {
  const brut = 'including Paul M&uuml;ller (founder of Adjust, &euro;1.2B exit) and Petter Made (founder of SumUp, &euro;8B)';
  assert.equal(
    decodeEntitesHtml(brut),
    'including Paul Müller (founder of Adjust, €1.2B exit) and Petter Made (founder of SumUp, €8B)',
  );
});

test('rattrape le double encodage (&amp;uuml; -> &uuml; -> ü)', () => {
  assert.equal(decodeEntitesHtml('M&amp;uuml;ller'), 'Müller');
  assert.equal(decodeEntitesHtml('Data &amp;amp; IA'), 'Data & IA');
});

test('entités numériques décimales et hexadécimales', () => {
  assert.equal(decodeEntitesHtml('&#233;t&#233;'), 'été');
  assert.equal(decodeEntitesHtml('caf&#x00e9;'), 'café');
});

test('&nbsp; devient une espace normale, pas une espace insécable', () => {
  const decode = decodeEntitesHtml('Data&nbsp;Scientist');
  assert.equal(decode, 'Data Scientist');
  assert.equal(decode.includes(' '), false);
});

test('une entité inconnue reste intacte, jamais remplacée par du vide', () => {
  assert.equal(decodeEntitesHtml('poste &zwj; junior'), 'poste &zwj; junior');
});

test('&lt;script&gt; ne redevient jamais une vraie balise après clean()', () => {
  // decodeEntitesHtml, pris seul, décode fidèlement lt/gt comme n'importe
  // quelle entité (c'est un décodeur pur, sans notion de balise) : une fois
  // décodée, la chaîne contient bien "<script>" en texte.
  const decode = decodeEntitesHtml('&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(decode, '<script>alert(1)</script>');

  // clean() retire les balises AVANT de décoder (une injection déjà présente
  // en HTML est retirée dès ce premier passage), PUIS retire les balises une
  // seconde fois après le décodage : une entité qui vient d'être décodée et
  // qui dessine elle-même une balise ("&lt;script&gt;" → "<script>") ne
  // survit donc jamais dans le texte final stocké en base.
  const via_clean = clean('&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(via_clean.includes('<script>'), false);
  assert.equal(via_clean, 'alert(1)');

  // Une vraie balise déjà présente dans le HTML d'origine est retirée dès le
  // premier passage, avant même que le décodage n'entre en jeu.
  assert.equal(clean('<script>alert(1)</script>'), 'alert(1)');
});

test('clean() retire les balises puis décode les entités (titre, entreprise, ville)', () => {
  assert.equal(clean('<p>Data &amp; IA &eacute;quipe</p>'), 'Data & IA équipe');
  assert.equal(clean(null), null);
  assert.equal(clean(undefined), null);
});
