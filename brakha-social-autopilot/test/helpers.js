import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { israelLocal } from '../src/time.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/hebcal-ramat-gan-2026-09_2027-05.json'), 'utf8'));
export const IL = (ymd, h, m = 0) => israelLocal(ymd, h, m);

/** לוח מאומת מתוך נתוני Hebcal אמיתיים (נשמרו כ-fixture) */
export function fixtureCalendar(fetchedAt = '2026-11-15T10:00:00Z') {
  return { source: 'fixture', fetchedAt, range: FIXTURE.range, location: FIXTURE.location, items: FIXTURE.items };
}

export function tmpStore({ calendar = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brakha-'));
  const s = new Store(dir);
  if (calendar) s.db.calendar = fixtureCalendar();
  return s;
}

/** fetch שנכשל תמיד — מוודא שבסימולציה אין שום קריאה לרשת */
export const noNetwork = async (url) => { throw new Error(`network call attempted: ${url}`); };
export const fixtureFetch = async () => ({ ok: true, status: 200, json: async () => FIXTURE });

export function addGroup(store, extra = {}) {
  const g = { id: store.nextId('G'), name: 'שיפוצים ברמת גן', type: 'facebook_group', url: 'https://www.facebook.com/groups/example', areas: ['ramat-gan'], services: [], allowLinks: true, minDaysBetweenPosts: 7, preferredHour: 10, rulesReviewed: true, autoPlan: true, status: 'active', ...extra };
  store.db.groups.push(g);
  return g;
}
