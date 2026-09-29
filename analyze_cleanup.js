const { chromium } = require('playwright');
const fs = require('fs');
const iconv = require('iconv-lite');

const URL = 'https://kanri.hitomgr.jp/lwf3/login/';
const ID = process.env.HITOMGR_ID_U003;
const PASSWORD = process.env.HITOMGR_PASSWORD_PASSU003;

function csvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        q = !q;
      }
    } else if (c === ',' && !q) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    cur += c;
    if (c === '"') {
      if (q && text[i + 1] === '"') {
        cur += text[++i];
      } else {
        q = !q;
      }
    }
    if (!q && (c === '\n' || c === '\r')) {
      if (c === '\r' && text[i + 1] === '\n') cur += text[++i];
      const s = cur.trim();
      if (s) lines.push(s);
      cur = '';
    }
  }
  if (cur.trim()) lines.push(cur.trim());
  const header = lines.length ? csvLine(lines[0]) : [];
  const rows = lines.slice(1).map(csvLine).filter(r => r.length);
  return { header, rows };
}

async function login(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const pass = page.locator('input[type="password"]').first();
  await pass.waitFor({ state: 'visible', timeout: 30000 });
  const user = page.locator(
    'input[type="text"],input[type="email"],input[name*="login"],input[name*="user"],input[name*="id"]'
  ).first();
  await user.fill(ID);
  await pass.fill(PASSWORD);
  const submit = page.locator(
    'button[type="submit"],input[type="submit"],button:has-text("ログイン"),a:has-text("ログイン")'
  ).first();
  await Promise.all([
    page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {}),
    submit.click({ force: true, timeout: 30000 })
  ]);
  await page.waitForTimeout(2500);
  if (await page.locator('input[type="password"]').first().isVisible().catch(() => false)) {
    throw new Error('ログイン後もログイン画面のままです');
  }
}

async function ensureHistory(page) {
  const u = 'https://kanri.hitomgr.jp/lwf3/csv_export_queues';
  await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  if (await page.locator('input[type="password"]').first().isVisible().catch(() => false)) {
    await login(page);
    await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  await page.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: 30000 });
}

async function latestCompleted(page) {
  const rows = page.locator('table tbody tr');
  const n = await rows.count();
  const items = [];
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    const cells = row.locator('td');
    if ((await cells.count()) < 3) continue;
    const date = (await cells.nth(0).innerText().catch(() => '')).trim();
    const status = (await cells.nth(2).innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    const detail = (await row.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    const link = row.locator('a[href*="/download/"],a[href*=".csv"],a:has-text("ダウンロード")').first();
    if (!/完了/.test(status) || !(await link.count())) continue;
    const href = await link.getAttribute('href').catch(() => null);
    const text = await link.innerText().catch(() => '');
    const key = (date.match(/\d+/g) || []).join('').padEnd(14, '0');
    const countMatch = detail.match(/全\s*(\d+)\s*件/);
    const totalCount = countMatch ? Number(countMatch[1]) : 0;
    items.push({ i, date, status, href, text, key, totalCount, detail });
  }
  items.sort((a,b) => {
    if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
    return b.key.localeCompare(a.key);
  });
  if (!items.length) throw new Error('完了済みのCSV取出しが見つかりません');
  const full = items.find(x => x.totalCount >= 50000);
  const chosen = full || items[0];
  console.log('[EXPORT] chosen total=' + chosen.totalCount + ' date=' + chosen.date + ' href=' + chosen.href);
  return chosen;
}

async function download(page) {
  const out = 'B_cleanup_analysis_raw.csv';
  for (let attempt = 1; attempt <= 12; attempt++) {
    await ensureHistory(page);
    const item = await latestCompleted(page);
    console.log('[DOWNLOAD] attempt=' + attempt + ' date=' + item.date + ' href=' + item.href);
    const row = page.locator('table tbody tr').nth(item.i);
    const link = row.locator('a[href*="/download/"],a[href*=".csv"],a:has-text("ダウンロード")').first();
    try {
      const p = page.waitForEvent('download', { timeout: 90000 });
      await link.click({ force: true, noWaitAfter: true, timeout: 30000 });
      const dl = await p;
      const fail = await dl.failure();
      if (fail) throw new Error(fail);
      await dl.saveAs(out);
      if (fs.existsSync(out) && fs.statSync(out).size > 0) {
        console.log('[DOWNLOAD] success bytes=' + fs.statSync(out).size);
        return out;
      }
    } catch (e) {
      console.log('[DOWNLOAD] failed ' + e.message);
    }
    await page.waitForTimeout(45000);
  }
  throw new Error('CSVダウンロードに12回失敗しました');
}

(async () => {
  if (!ID || !PASSWORD) throw new Error('Bアカウントの認証情報がありません');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await login(page);
    const file = await download(page);
    const text = iconv.decode(fs.readFileSync(file), 'Shift_JIS');
    const { header, rows } = parseCsv(text);

    const D = 3;
    const A = 0;
    const B = 1;
    const C = 2;
    const K = 10;

    const clean = v => String(v || '').replace(/^"|"$/g, '').trim();
    const published = rows.filter(r => clean(r[D]) === '掲載').length;
    const unpublished = rows.filter(r => clean(r[D]) === '非掲載').length;

    const groups = new Map();
    let idMatched = 0;
    for (let index = 0; index < rows.length; index++) {
      const r = rows[index];
      const a = clean(r[A]);
      const m = a.match(/(RB\d{3})(\d{8})(.*)/);
      if (!m) continue;
      idMatched++;
      const norm = m[1] + 'YYYYMMDD' + m[3];
      const date = m[2];
      if (!groups.has(norm)) groups.set(norm, []);
      groups.get(norm).push({
        index,
        date,
        status: clean(r[D]),
        b: clean(r[B]),
        c: clean(r[C]),
        k: clean(r[K])
      });
    }

    let duplicateGroups = 0;
    let obsoleteAll = 0;
    let obsoletePublished = 0;
    let obsoleteUnpublished = 0;
    let sameLatestExtras = 0;
    const sizes = {};

    for (const arr of groups.values()) {
      sizes[arr.length] = (sizes[arr.length] || 0) + 1;
      if (arr.length <= 1) continue;
      duplicateGroups++;
      arr.sort((x,y) => y.date.localeCompare(x.date));
      const latestDate = arr[0].date;
      let keptLatest = false;
      for (const x of arr) {
        let obsolete = false;
        if (x.date < latestDate) {
          obsolete = true;
        } else if (x.date === latestDate) {
          if (!keptLatest) keptLatest = true;
          else {
            obsolete = true;
            sameLatestExtras++;
          }
        }
        if (obsolete) {
          obsoleteAll++;
          if (x.status === '掲載') obsoletePublished++;
          if (x.status === '非掲載') obsoleteUnpublished++;
        }
      }
    }

    const dateCounts = {};
    for (const r of rows) {
      const a = clean(r[A]);
      const m = a.match(/(RB\d{3})(\d{8})/);
      if (m) dateCounts[m[2]] = (dateCounts[m[2]] || 0) + 1;
    }
    const recentDates = Object.entries(dateCounts)
      .sort((a,b) => b[0].localeCompare(a[0]))
      .slice(0, 20);

    const summary = {
      generatedAt: new Date().toISOString(),
      totalRows: rows.length,
      headerCount: header.length,
      publishedRows: published,
      unpublishedRows: unpublished,
      otherStatusRows: rows.length - published - unpublished,
      idMatchedRows: idMatched,
      normalizedIdGroups: groups.size,
      duplicateGroups,
      obsoleteDuplicateRows: obsoleteAll,
      obsoleteDuplicatePublishedRows: obsoletePublished,
      obsoleteDuplicateUnpublishedRows: obsoleteUnpublished,
      sameLatestDateExtraRows: sameLatestExtras,
      groupSizeDistribution: sizes,
      recentIdDates: recentDates,
      headerNames: header
    };

    fs.writeFileSync('B_cleanup_analysis_summary.json', JSON.stringify(summary, null, 2), 'utf8');
    console.log('===CLEANUP_ANALYSIS_START===');
    console.log(JSON.stringify(summary));
    console.log('===CLEANUP_ANALYSIS_END===');
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error('[FATAL] ' + e.stack);
  process.exit(1);
});
