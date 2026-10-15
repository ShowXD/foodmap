import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { emptyFilter, matchesFilter, sortPlaces, state, tagCounts, tagsOf } from '../public/state.js';

// Taichung 西區; 江家 is ~0.2 km away, 阿宗 in Taipei ~130 km, the nameless one has no position.
const HERE = { lat: 24.15, lng: 120.665 };
const PLACES = [
  { id: 5, name: '春水堂', tags: '飲料 #下午茶', created_at: '2026-10-14 10:00:00', starred: 1, lat: null, lng: null },
  { id: 4, name: '', tags: '', created_at: '2026-10-12 10:00:00', lat: null, lng: null, garbled: [] },
  { id: 3, name: '林東芳牛肉麵', tags: '["牛肉麵", "宵夜"]', created_at: '2026-10-10 10:00:00', lat: 25.048, lng: 121.541, garbled: ['name'] },
  { id: 2, name: '阿宗麵線', tags: '小吃', created_at: '2026-10-05 10:00:00', lat: 25.043, lng: 121.507, my_visited_at: '2026-10-06', duplicates: [9] },
  { id: 1, name: '江家餛飩', tags: '##宵夜 ＃平價', created_at: '2026-10-01 10:00:00', lat: 24.149, lng: 120.664, my_visited_at: '2026-10-02' },
];
const ids = (places) => places.map((place) => place.id);
const shown = () => ids(PLACES.filter(matchesFilter));

beforeEach(() => {
  Object.assign(state, { places: PLACES, filter: emptyFilter(), sort: 'newest', search: '', myPosition: null });
});

test('tagsOf drops #, ＃, quotes and brackets, and repeats', () => {
  assert.deepEqual(tagsOf({ tags: '#宵夜 ##平價 ＃台中 宵夜' }), ['宵夜', '平價', '台中']);
  assert.deepEqual(tagsOf({ tags: '["台中", "西區美食"] 「台中」' }), ['台中', '西區美食']);
  assert.deepEqual(tagsOf({ tags: null }), []);
});

test('tagCounts: most used first, ties in Chinese order', () => {
  assert.deepEqual(tagCounts(PLACES), [['宵夜', 2], ['下午茶', 1], ['小吃', 1], ['牛肉麵', 1], ['平價', 1], ['飲料', 1]]);
});

test('each filter narrows on its own', () => {
  assert.deepEqual(shown(), [5, 4, 3, 2, 1]);
  state.filter.status = 'todo';
  assert.deepEqual(shown(), [5, 4, 3]);
  state.filter.status = 'visited';
  assert.deepEqual(shown(), [2, 1]);
  state.filter.status = 'starred';
  assert.deepEqual(shown(), [5]);

  state.filter = emptyFilter();
  state.filter.issue = 'no-name';
  assert.deepEqual(shown(), [4]);
  state.filter.issue = 'no-location';
  assert.deepEqual(shown(), [5], 'a nameless place counts only as 沒店名');
  state.filter.issue = 'garbled';
  assert.deepEqual(shown(), [3]);
  state.filter.issue = 'duplicate';
  assert.deepEqual(shown(), [2]);

  state.filter = emptyFilter();
  state.filter.tag = '宵夜';
  assert.deepEqual(shown(), [3, 1]);

  state.filter = emptyFilter();
  state.search = '麵';
  assert.deepEqual(shown(), [3, 2]);
});

test('filters combine, and the range needs a position', () => {
  state.filter.radius = 3;
  assert.deepEqual(shown(), [], 'no position: nothing is known to be close');
  state.myPosition = HERE;
  assert.deepEqual(shown(), [1]);
  state.filter.radius = null;
  state.filter.tag = '宵夜';
  state.filter.status = 'todo';
  assert.deepEqual(shown(), [3]);
});

test('sorting: newest keeps the server order; places missing the key go last', () => {
  assert.deepEqual(ids(sortPlaces(PLACES)), [5, 4, 3, 2, 1]);
  state.sort = 'oldest';
  assert.deepEqual(ids(sortPlaces(PLACES)), [1, 2, 3, 4, 5]);
  state.sort = 'name';
  assert.equal(sortPlaces(PLACES).at(-1).id, 4, 'nameless last');
  assert.deepEqual(new Set(ids(sortPlaces(PLACES))), new Set([1, 2, 3, 4, 5]));
  state.sort = 'distance';
  state.myPosition = HERE;
  assert.deepEqual(ids(sortPlaces(PLACES)).slice(0, 3), [1, 2, 3]);
  assert.deepEqual(new Set(ids(sortPlaces(PLACES)).slice(3)), new Set([4, 5]), 'unlocated last');
  assert.deepEqual(ids(PLACES), [5, 4, 3, 2, 1], 'the list itself is not reordered');
});
