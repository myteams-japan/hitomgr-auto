const { chromium } = require('playwright');

const ID = process.env.HITOMGR_ID_U003;
const PASSWORD = process.env.HITOMGR_PASSWORD_PASSU003;
const LOGIN = 'https://kanri.hitomgr.jp/lwf3/login/';
const QUEUE = 'https://kanri.hitomgr.jp/lwf3/csv_export_queues';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(LOGIN, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const user = page.locator('input[type="text"],input[type="email"],input[name*="login"],input[name*="user"],input[name*="id"]').first();
    const pass = page.locator('input[type="password"]').first();
    await user.fill(ID);
    await pass.fill(PASSWORD);
    const submit = page.locator('button[type="submit"],input[type="submit"],button:has-text("ログイン"),a:has-text("ログイン")').first();
    await submit.click({ force: true });
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
    await page.goto(QUEUE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: 30000 });

    const rows = await page.locator('table tbody tr').evaluateAll(rows => rows.map((row,index)=>{
      const cells=[...row.querySelectorAll('td')];
      return {
        index,
        date: cells[0]?.innerText?.trim() || '',
        type: cells[1]?.innerText?.trim() || '',
        status: cells[2]?.innerText?.replace(/\s+/g,' ').trim() || '',
        detail: cells[3]?.innerText?.replace(/\s+/g,' ').trim() || '',
        deleteDate: cells[4]?.innerText?.trim() || ''
      };
    }));
    console.log('===EXPORT_ROWS_START===');
    console.log(JSON.stringify(rows));
    console.log('===EXPORT_ROWS_END===');
  } finally {
    await browser.close();
  }
})().catch(e=>{ console.error(e.stack); process.exit(1); });
