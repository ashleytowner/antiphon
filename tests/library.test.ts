import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { classify, titleMatches } from '../src/main/classify';
import { Library } from '../src/main/library';

test('classifies structured folders and the agreed album defaults', () => {
  assert.deepEqual(classify('MGS Audio/sfx/scifi/Weapons/Blaster.ogg'), { type: 'SFX', era: 'scifi', genre: 'Weapons', needsReview: false, reason: 'MGS folder structure' });
  assert.equal(classify('Albums/RPG Ambiences Vol. 1/Blizzard.ogg').era, 'generic');
  assert.equal(classify('Albums/RPG Ambiences Vol. 1/Elven Forest.ogg').era, 'fantasy');
  assert.equal(classify('Albums/Sci​-​Fi Ambiences Vol. 1/Station.ogg').era, 'scifi');
  assert.equal(classify('Albums/Black Void/Dhaarese Harbour.ogg').genre, 'Coastal');
  assert.equal(classify('Albums/Combat Music Collection Vol. 1/Unknown.ogg').genre, 'Combat');
});

test('uses title evidence but rejects ambiguous MGS matches', () => {
  const files = ['MGS Audio/music/fantasy/Exploration/Into the Feywilds (Loop).ogg'];
  assert.equal(classify('Albums/Biomes/Into the Feywilds.ogg', titleMatches(files)).genre, 'Exploration');
  files.push('MGS Audio/music/scifi/Mystery/Into the Feywilds.ogg');
  assert.equal(titleMatches(files).size, 0);
});

test('indexes each file independently, preserves edits, marks missing, and isolates libraries', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-library-'));
  const library = new Library(':memory:');
  try {
    const folder = path.join(root, 'Albums/Black Void');
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'Harbor.ogg'), 'same');
    await writeFile(path.join(folder, 'Harbor (abc123).ogg'), 'same');
    await writeFile(path.join(folder, 'cover.jpg'), 'image');
    assert.equal(await library.scan(root), 2);
    let result = library.query(root, {});
    assert.equal(result.total, 2);
    const id = result.tracks.find(t => t.title === 'Harbor')!.id;
    library.edit(root, id, { type: 'Music', era: 'cthulhu', genre: 'Mystery' });
    await library.scan(root);
    assert.equal(library.query(root, { era: 'cthulhu' }).tracks[0].id, id);
    assert.equal(library.query(root, { reviewOnly: true }).total, 1);
    assert.equal(library.query(root, { search: '%' }).total, 0);
    assert.equal(library.query('/another-root', {}).total, 0);
    await rm(path.join(folder, 'Harbor.ogg'));
    await library.scan(root);
    assert.equal(library.query(root, {}).total, 1);
    assert.equal(library.query(root, { includeMissing: true }).total, 2);
    assert.equal(library.file(root, id), undefined);
    await assert.rejects(library.scan(path.join(root, 'does-not-exist')));
    result = library.query(root, {});
    assert.equal(result.total, 1);
  } finally { library.close(); await rm(root, { recursive: true, force: true }); }
});
