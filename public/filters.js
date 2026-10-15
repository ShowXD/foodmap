// The 篩選與排序 sheet, and the row above the list and the map showing what is chosen (they share one filter).
import { fitToRadius } from './map.js';
import { $, openDialog } from './shared.js';
import { distanceTo, emptyFilter, PLACE_ISSUES, SORTS, state, STATUSES, tagsByUse } from './state.js';

const NEAR_RADII_KM = [1, 3, 5];
const QUICK_RADIUS_KM = 3;
const NEARBY_KM = 5; // tags of shops this close count as "around here" for the quick picks
const QUICK_TAG_COUNT = 3;
const filterDialog = $('filter-dialog');
const sections = $('filter-sections');
let onChange = () => {};

/** `handler` redraws the page after any change (app.js renderPlaces). */
export function connectFilters(handler) {
  onChange = handler;
}

function chip(label, isActive, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chip';
  button.textContent = label;
  button.setAttribute('aria-pressed', String(isActive));
  button.addEventListener('click', onClick);
  return button;
}

function change(update, { fit = false } = {}) {
  update();
  onChange();
  if (fit) fitToRadius(); // after the redraw, which places the circle
  if (filterDialog.open) renderSections();
}

// Each chosen condition, with how to drop it; the default sort (新到舊) isn't a condition.
function chosenConditions() {
  const { filter } = state;
  return [
    filter.status !== 'all' && [STATUSES[filter.status], () => { filter.status = 'all'; }],
    filter.radius && [`📍 ${filter.radius} 公里內`, () => { filter.radius = null; }],
    filter.issue && [PLACE_ISSUES[filter.issue].label, () => { filter.issue = null; }],
    filter.tag && [filter.tag, () => { filter.tag = null; }],
    state.sort !== 'newest' && [`排序：${SORTS[state.sort].label}`, () => { state.sort = 'newest'; }],
  ].filter(Boolean);
}

// One tap, no sheet: 想吃, 未吃, a range when we know where the person is, and the tags most used by the
// shops around them (or in the whole list when nothing is close), e.g. 西區美食 when standing in 西區.
function quickPicks() {
  const { filter } = state;
  const nearby = state.places.filter((place) => (distanceTo(place) ?? Infinity) <= NEARBY_KM);
  const around = nearby.length ? nearby : state.places;
  const tags = filter.tag ? [] : tagsByUse(around).slice(0, QUICK_TAG_COUNT);
  return [
    filter.status !== 'starred' && [STATUSES.starred, () => { filter.status = 'starred'; }],
    filter.status !== 'todo' && [STATUSES.todo, () => { filter.status = 'todo'; }],
    state.myPosition && !filter.radius && [`📍 ${QUICK_RADIUS_KM} 公里內`, () => { filter.radius = QUICK_RADIUS_KM; }, { fit: true }],
    ...tags.map((tag) => [tag, () => { filter.tag = tag; }]),
  ].filter(Boolean);
}

export function renderFilterBar() {
  const chosen = chosenConditions();
  const picks = quickPicks();
  for (const container of [$('filter-chips'), $('map-chips')]) {
    const open = chip(chosen.length ? `⚙️ 篩選・排序 ${chosen.length}` : '⚙️ 篩選・排序', false, openFilterPanel);
    open.removeAttribute('aria-pressed');
    open.setAttribute('aria-haspopup', 'dialog');
    open.classList.add('filter-open');
    container.replaceChildren(
      open,
      ...chosen.map(([label, drop]) => {
        const button = chip(`${label} ✕`, true, () => change(drop));
        button.setAttribute('aria-label', `取消「${label}」`);
        return button;
      }),
      ...picks.map(([label, pick, options]) => chip(label, false, () => change(pick, options))),
    );
  }
}

function section(title, chips, hint = '') {
  const wrapper = document.createElement('section');
  const heading = document.createElement('h3');
  heading.textContent = title;
  const row = document.createElement('div');
  row.className = 'filter-options';
  row.append(...chips);
  if (hint) row.append(Object.assign(document.createElement('p'), { className: 'meta', textContent: hint }));
  wrapper.append(heading, row);
  return wrapper;
}

function renderSections() {
  const { filter } = state;
  const hasPosition = Boolean(state.myPosition);
  const issues = Object.entries(PLACE_ISSUES)
    .map(([key, { label, test }]) => [key, label, state.places.filter(test).length])
    .filter(([, , count]) => count);
  const tags = tagsByUse(state.places);
  const toggle = (key, value) => () => change(() => { filter[key] = filter[key] === value ? null : value; });
  sections.replaceChildren(...[
    section('排序', Object.entries(SORTS)
      .filter(([key]) => key !== 'distance' || hasPosition)
      .map(([key, { label }]) => chip(label, state.sort === key, () => change(() => { state.sort = key; })))),
    section('狀態', Object.entries(STATUSES).map(([key, label]) => chip(label, filter.status === key, () => change(() => { filter.status = key; })))),
    hasPosition
      ? section('距離', [null, ...NEAR_RADII_KM].map((km) => chip(km ? `${km} 公里內` : '不限', filter.radius === km, () => change(() => { filter.radius = km; }, { fit: Boolean(km) }))))
      : section('距離', [], '開啟定位後，可以依距離篩選與排序'),
    issues.length > 0 && section('待處理', issues.map(([key, label, count]) => chip(`${label} ${count}`, filter.issue === key, toggle('issue', key)))),
    tags.length > 0 && section('標籤', tags.map((tag) => chip(tag, filter.tag === tag, toggle('tag', tag)))),
  ].filter(Boolean));
}

function openFilterPanel() {
  renderSections();
  openDialog(filterDialog);
}

$('filter-clear').addEventListener('click', () => change(() => {
  state.filter = emptyFilter();
  state.sort = 'newest';
}));
