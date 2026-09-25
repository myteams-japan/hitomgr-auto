const { chromium } = require('playwright');
// manual run trigger 2026-09-25T01:56:10.744Z
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');
const accounts = [
  {
    name: 'A',
    url: 'https://kanri.hitomgr.jp/72s3/login/',
    id: process.env.HITOMGR_ID_M003,
    password: process.env.HITOMGR_PASSWORD_PASSU003
  },
  {
    name: 'B',
    url: 'https://kanri.hitomgr.jp/lwf3/login/',
    id: process.env.HITOMGR_ID_U003,
    password: process.env.HITOMGR_PASSWORD_PASSU003
  }
];
const CHATWORK_ROOM_ID = '397819592';

function safeLog(value) {
  let text = String(value);
  for (const account of accounts) {
    for (const secret of [account.id, account.password]) {
      if (secret) {
        text = text.split(secret).join('[REDACTED]');
      }
    }
  }
  return text.replace(/https?:\/\/[^\s"'<>]+/g, url => {
    try {
      const parsed = new URL(url);
      return parsed.origin + parsed.pathname;
    } catch {
      return '[URL]';
    }
  }).slice(0, 1500);
}

async function sendChatworkError(currentState, acc, error) {
  const token = process.env.CHATWORK_API_TOKEN;
  if (!token) {
    console.warn('⚠️ CHATWORK_API_TOKENが設定されていないためChatwork通知を送信できません。');
    return;
  }
  const message = [
    '[info][title]HITO-Manager 自動処理エラー[/title]',
    `処理：${currentState}`,
    `アカウント：${acc ? acc.name : '不明'}`,
    `失敗工程：${acc && acc.logStage ? acc.logStage : '不明'}`,
    `予約：${acc && acc.exportRequestKey ? acc.exportRequestKey : '未取得'}`,
    '',
    'エラー：',
    safeLog(error && error.message ? error.message : error),
    '',
    'GitHub Actionsを確認してください。',
    '[/info]'
  ].join('\n');
  try {
    const response = await fetch(
      `https://api.chatwork.com/v2/rooms/${CHATWORK_ROOM_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'X-ChatWorkToken': token,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          body: message,
          self_unread: '1'
        }).toString()
      }
    );
    const responseText = await response.text();
    if (!response.ok) {
      console.warn(
        `⚠️ Chatwork通知失敗 HTTP ${response.status}: ${safeLog(responseText)}`
      );
      return;
    }
    console.log('✅ Chatworkへエラー通知を送信しました。');
  } catch (notifyError) {
    console.warn(
      `⚠️ Chatwork通知処理でエラー: ${safeLog(notifyError.message)}`
    );
  }
}

function logStage(acc, stage) {
  const now = Date.now();
  if (acc.logStage) {
    console.log(
      '[工程終了] ' + acc.name +
      ' / ' + acc.logStage +
      ' / ' + Math.round((now - acc.logStageAt) / 1000) + '秒'
    );
  }
  acc.logStage = stage;
  acc.logStageAt = now;
  console.log('[工程開始] ' + acc.name + ' / ' + stage);
}

async function logFailure(page, acc, error) {
  console.error(
    '[失敗箇所] ' + acc.name +
    ' / ' + (acc.logStage || '準備前') +
    ' / 予約=' + (acc.exportRequestKey || '未取得')
  );
  console.error('[失敗理由] ' + safeLog(error.message));
  if (page) {
    console.error('[画面] ' + safeLog(page.url()));
    const login = await page
      .locator('input[type="password"]')
      .first()
      .isVisible()
      .catch(() => false);
    console.error('[画面状態] ログイン画面=' + login);
  }
}

function colNameToIndex(colName) {
  let index = 0;
  for (let i = 0; i < colName.length; i++) {
    index = index * 26 + (colName.charCodeAt(i) - 64);
  }
  return index - 1;
}

function parseCSVContentRobust(content) {
  const rows = [];
  let currentRawLine = '';
  let inQuotes = false;
  let isHeader = true;
  let headerLine = '';
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    currentRawLine += char;
    if (char === '"') {
      inQuotes = !inQuotes;
    }
    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && content[i + 1] === '\n') {
        currentRawLine += content[i + 1];
        i++;
      }
      const trimmedLine = currentRawLine.trim();
      if (trimmedLine) {
        if (isHeader) {
          headerLine = trimmedLine;
          isHeader = false;
        } else {
          const parsed = parseSingleCSVLine(trimmedLine);
          if (parsed.length > 0 && parsed[0] !== '') {
            rows.push(parsed);
          }
        }
      }
      currentRawLine = '';
    }
  }
  if (currentRawLine.trim() && !isHeader) {
    const parsed = parseSingleCSVLine(currentRawLine.trim());
    if (parsed.length > 0 && parsed[0] !== '') {
      rows.push(parsed);
    }
  }
  return { headerLine, rows };
}

function parseSingleCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function toCSVLine(arr) {
  return arr.map(val => {
    if (
      val &&
      (
        val.includes(',') ||
        val.includes('"') ||
        val.includes('\n') ||
        val.includes('\r')
      )
    ) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val || '';
  }).join(',');
}

function getTargetDates() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return {
    hyphenToday: `${yyyy}/${now.getMonth() + 1}/${now.getDate()}`,
    flatToday: `${yyyy}${mm}${dd}`,
    future10Years: `${yyyy + 10}/${now.getMonth() + 1}/${now.getDate()}`
  };
}

function generatePatternFiles(
  headerLine,
  targetRows,
  basePath,
  accountName,
  label
) {
  const idxA = colNameToIndex('A');
  const idxB = colNameToIndex('B');
  const idxC = colNameToIndex('C');
  const idxD = colNameToIndex('D');
  const idxK = colNameToIndex('K');
  const pattern1Rows = targetRows.map(orgRow => {
    const row = [...orgRow];
    if (row[idxB]) {
      const rawB = row[idxB].replace(/"/g, '').trim();
      const partsB = rawB.split('/');
      if (partsB.length === 3) {
        row[idxB] = `2019/${partsB[1]}/${partsB[2]}`;
      }
    }
    if (row[idxC]) {
      const rawC = row[idxC].replace(/"/g, '').trim();
      const partsC = rawC.split('/');
      if (partsC.length === 3) {
        row[idxC] = `2020/${partsC[1]}/${partsC[2]}`;
      }
    }
    row[idxD] = '非掲載';
    return row;
  });
  const path1 = basePath.replace('.csv', `_${label}_pattern1.csv`);
  const content1 = [
    headerLine,
    ...pattern1Rows.map(toCSVLine)
  ].join('\r\n');
  fs.writeFileSync(path1, iconv.encode(content1, 'Shift_JIS'));
  console.log(
    `✅ 【${accountName}】【${label}】パターン1 CSV保存完了: ${path1}`
  );
  const dates = getTargetDates();
  const pattern2BaseRows = targetRows.map(orgRow => {
    const row = [...orgRow];
    if (row[idxA]) {
      const currentA = row[idxA].replace(/"/g, '').trim();
      row[idxA] = currentA.replace(
        /(RB\d{3})\d{8}/,
        `$1${dates.flatToday}`
      );
    }
    row[idxB] = dates.hyphenToday;
    row[idxC] = dates.future10Years;
    row[idxD] = '掲載';
    return row;
  });
  if (pattern2BaseRows.length > 1) {
    const lastKValue =
      pattern2BaseRows[pattern2BaseRows.length - 1][idxK];
    for (let i = pattern2BaseRows.length - 1; i > 0; i--) {
      pattern2BaseRows[i][idxK] = pattern2BaseRows[i - 1][idxK];
    }
    pattern2BaseRows[0][idxK] = lastKValue;
    console.log(
      `🔄 【${accountName}】【${label}】K列のローテーション完了。`
    );
  }
  const path2 = basePath.replace('.csv', `_${label}_pattern2.csv`);
  const content2 = [
    headerLine,
    ...pattern2BaseRows.map(toCSVLine)
  ].join('\r\n');
  fs.writeFileSync(path2, iconv.encode(content2, 'Shift_JIS'));
  console.log(
    `✅ 【${accountName}】【${label}】パターン2 CSV保存完了: ${path2}`
  );
  return { path1, path2 };
}

function processCSVFile(filePath, accountName) {
  if (!fs.existsSync(filePath)) {
    console.log(
      `⚠️ 【${accountName}】ファイルが見つかりません: ${filePath}`
    );
    return null;
  }
  console.log(`🛠️ 【${accountName}】CSVの加工処理を開始します。`);
  const buffer = fs.readFileSync(filePath);
  const content = iconv.decode(buffer, 'Shift_JIS');
  const idxB = colNameToIndex('B');
  const idxGG = colNameToIndex('GG');
  const idxGH = colNameToIndex('GH');
  const { headerLine, rows: allRows } = parseCSVContentRobust(content);
  if (allRows.length === 0) {
    return null;
  }
  const normalFiltered = allRows.filter(row => {
    const valGG = row[idxGG]
      ? row[idxGG].replace(/"/g, '').trim()
      : '';
    const valGH = row[idxGH]
      ? row[idxGH].replace(/"/g, '').trim()
      : '';
    const isBothActive =
      (valGG !== '0' && valGG !== '') &&
      (valGH !== '0' && valGH !== '');
    return !isBothActive;
  });
  normalFiltered.sort((x, y) => {
    const dateX = x[idxB] ? x[idxB].replace(/"/g, '').trim() : '';
    const dateY = y[idxB] ? y[idxB].replace(/"/g, '').trim() : '';
    return new Date(dateX) - new Date(dateY);
  });
  const normalTargetRows = normalFiltered.slice(0, 3990);
  const normalFiles = generatePatternFiles(
    headerLine,
    normalTargetRows,
    filePath,
    accountName,
    'normal'
  );
  const pvSorted = [...allRows].sort((x, y) => {
    const valX = parseFloat(
      x[idxGH] ? x[idxGH].replace(/"/g, '').trim() : 0
    ) || 0;
    const valY = parseFloat(
      y[idxGH] ? y[idxGH].replace(/"/g, '').trim() : 0
    ) || 0;
    return valY - valX;
  });
  const pvSliced = pvSorted.slice(0, 3990);
  pvSliced.sort((x, y) => {
    const dateX = x[idxB] ? x[idxB].replace(/"/g, '').trim() : '';
    const dateY = y[idxB] ? y[idxB].replace(/"/g, '').trim() : '';
    return new Date(dateX) - new Date(dateY);
  });
  const pvFiles = generatePatternFiles(
    headerLine,
    pvSliced,
    filePath,
    accountName,
    'pv'
  );
  return {
    normal: normalFiles,
    pv: pvFiles
  };
}

async function navigateViaMenuOrUrl(
  page,
  acc,
  targetText,
  targetUrlSegment
) {
  try {
    const menuHoverIcon = page.locator(
      'li:has(a:has-text("面接カレンダー")) + li, ' +
      'ul.nav-tabs li:nth-child(5), ' +
      '.nav-tabs li a:has(img), li:has(.fa-refresh)'
    ).first();
    if (await menuHoverIcon.count() > 0) {
      await menuHoverIcon.hover();
      await page.waitForTimeout(1000);
      const subMenuLink = page
        .locator(`a:has-text("${targetText}")`)
        .first();
      if (
        await subMenuLink.count() > 0 &&
        await subMenuLink.isVisible()
      ) {
        await subMenuLink.click();
        await page.waitForLoadState('networkidle')
          .catch(() => {});
        return;
      }
    }
  } catch (err) {
  }
  const destinationUrl = acc.url.replace(
    '/login/',
    `/${targetUrlSegment}`
  );
  await page.goto(destinationUrl, {
    waitUntil: 'networkidle'
  }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function uploadSingleFileOnly(
  page,
  acc,
  fileToUpload,
  label
) {
  try {
    logStage(acc, label + ' / 取込画面へ移動');
    console.log(
      `👉 【${acc.name}】[${label}] 募集一覧画面へ移動します。`
    );
    const recruitUrl = acc.url.replace(
      '/login/',
      '/rec_recruitments'
    );
    await page.goto(recruitUrl, {
      waitUntil: 'domcontentloaded'
    }).catch(() => {});
    console.log(
      `👉 【${acc.name}】[${label}] ファイル取込予約を開きます。`
    );
    const openModalBtn = page
      .locator('a:has-text("ファイル取込予約")')
      .first();
    await openModalBtn.waitFor({
      state: 'visible',
      timeout: 10000
    });
    await openModalBtn.click({ force: true });
    await page.waitForTimeout(2000);
    logStage(acc, label + ' / ファイル入力要素取得');
    let targetInput = null;
    let activeFrame = null;
    const mainInput = page.locator('input[type="file"]').first();
    if (await mainInput.count() > 0) {
      targetInput = mainInput;
    } else {
      console.log(
        `🔍 【${acc.name}】[${label}] iframe内を探索します。`
      );
      for (const frame of page.frames()) {
        const frameInput = frame
          .locator('input[type="file"]')
          .first();
        if (await frameInput.count() > 0) {
          targetInput = frameInput;
          activeFrame = frame;
          console.log(
            `💡 【${acc.name}】[${label}] iframe内で入力要素を検出。`
          );
          break;
        }
      }
    }
    if (targetInput) {
      logStage(acc, label + ' / ファイル選択');
      await targetInput.setInputFiles(fileToUpload);
      console.log(
        `✅ 【${acc.name}】[${label}] ファイル選択成功。`
      );
    } else {
      console.log(
        `⚠️ 【${acc.name}】[${label}] 入力要素がありません。再探索します。`
      );
      const customUploadBtn = page.locator(
        'text=ファイルを選択, text=ファイル選択, ' +
        'button:has-text("選択"), .file-upload, .upload-area'
      ).first();
      if (await customUploadBtn.count() > 0) {
        customUploadBtn.click({ force: true })
          .catch(() => {});
      }
      const retryInput = page
        .locator('input[type="file"]')
        .first();
      if (await retryInput.count() > 0) {
        await retryInput.setInputFiles(fileToUpload)
          .catch(() => {});
      }
    }
    await page.waitForTimeout(1500);
    logStage(acc, label + ' / 取込予約ボタン取得');
    let targetClickBtn = null;
    const targetContext = activeFrame || page;
    const universalSelectors = [
      ':text("ファイル取込予約")',
      'a:has-text("ファイル取込予約")',
      '[class*="btn"]:has-text("ファイル取込予約")',
      'div:has-text("ファイル取込予約")',
      'button:has-text("ファイル取込予約")'
    ];
    for (const selector of universalSelectors) {
      const el = targetContext.locator(selector).last();
      if (await el.count() > 0) {
        targetClickBtn = el;
        console.log(`🎯 ボタンを捕捉: ${selector}`);
        break;
      }
    }
    if (!targetClickBtn) {
      for (const frame of page.frames()) {
        const el = frame
          .locator(':text("ファイル取込予約")')
          .last();
        if (await el.count() > 0) {
          targetClickBtn = el;
          break;
        }
      }
    }
    if (!targetClickBtn) {
      throw new Error(
        'ファイル取込予約の実行ボタンを特定できませんでした。'
      );
    }
    await targetClickBtn.scrollIntoViewIfNeeded({
      timeout: 5000
    }).catch(() => {});
    logStage(acc, label + ' / 取込予約ボタンクリック');
    await targetClickBtn.click({
      force: true,
      timeout: 15000
    });
    console.log(
      `🚀 【${acc.name}】[${label}] クリックイベントの送信完了。`
    );
    logStage(acc, label + ' / 送信後30秒待機');
    await page.waitForTimeout(30000);
    logStage(
      acc,
      label + ' / 送信操作終了（サーバー取込完了は未検証）'
    );
  } catch (error) {
    await logFailure(page, acc, error);
    throw error;
  }
}

function exportDateKey(text) {
  const match = text.match(
    /(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/
  );
  return match
    ? match.slice(1).map(
        (part, i) => (part || '0').padStart(i === 0 ? 4 : 2, '0')
      ).join('')
    : null;
}

async function restoreExportSession(page, acc) {
  const password = page.locator('input[type="password"]').first();
  if (!(await password.isVisible().catch(() => false))) {
    return false;
  }

  logStage(acc, 'ログイン切れからの再認証');
  if (!acc.id || !acc.password) {
    throw new Error('再ログイン用の認証設定がありません。');
  }

  console.log(
    `🔐 【${acc.name}】ログイン画面を検出。同じ予約の監視を再開します。`
  );

  const loginUrl = acc.url;
  const history = acc.name === 'B'
    ? 'csv_export_queues'
    : 'rec_export_histories';
  const historyUrl = acc.url.replace('/login/', '/' + history);

  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      if (!page.url().includes('/session/new') && !page.url().includes('/login')) {
        await page.goto(loginUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 60000
        }).catch(() => {});
      }

      const pass = page.locator('input[type="password"]').first();
      await pass.waitFor({ state: 'visible', timeout: 30000 });

      const user = page.locator(
        'input[type="text"], input[type="email"], input[name*="login"], input[name*="user"], input[name*="id"]'
      ).first();

      await user.fill(acc.id, { timeout: 30000 });
      await pass.fill(acc.password, { timeout: 30000 });

      const submit = page.locator(
        'button[type="submit"], input[type="submit"], button:has-text("ログイン"), a:has-text("ログイン")'
      ).first();

      await Promise.all([
        page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {}),
        submit.click({ force: true, timeout: 30000 })
      ]);

      await page.waitForTimeout(3000);

      const stillLogin = await page.locator('input[type="password"]')
        .first().isVisible().catch(() => false);

      if (stillLogin) {
        const bodyText = await page.locator('body').innerText().catch(() => '');
        const authRejected = /認証|ログイン.*失敗|ID.*パスワード|パスワード.*(違|誤)|アカウント.*(ロック|無効)/i.test(bodyText);
        if (authRejected) {
          throw new Error(
            'ヒトマネ側でIDまたはパスワードが拒否されました。GitHub Secretsの認証情報確認が必要です。'
          );
        }
        throw new Error('ログイン送信後もログイン画面のままです。');
      }

      await page.goto(historyUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      await page.waitForTimeout(2000);

      const redirectedToLogin = await page.locator('input[type="password"]')
        .first().isVisible().catch(() => false);

      if (redirectedToLogin) {
        throw new Error('一覧へ移動すると再びログイン画面へ戻りました。');
      }

      logStage(acc, '再認証成功・同じ予約の監視再開');
      return true;
    } catch (error) {
      lastError = error;
      console.warn(
        `⚠️ 【${acc.name}】再ログイン試行 ${attempt}/5 失敗: ${safeLog(error.message)}`
      );

      if (/IDまたはパスワードが拒否/.test(error.message)) {
        throw error;
      }

      if (attempt < 5) {
        const waitMs = attempt * 15000;
        console.log(
          `⏳ 【${acc.name}】${waitMs / 1000}秒後に再ログインします。`
        );
        await page.waitForTimeout(waitMs);
        await page.goto(loginUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 60000
        }).catch(() => {});
      }
    }
  }

  throw new Error(
    '再ログインを5回試行しましたが成功しませんでした。' +
    (lastError ? ' 最終エラー: ' + safeLog(lastError.message) : '')
  );
}

async function getLatestExportStatus(page, acc) {
  await restoreExportSession(page, acc);
  await page.locator('table tbody tr td').first().waitFor({
    state: 'visible',
    timeout: 15000
  }).catch(() => {});
  const snapshots = await page
    .locator('table tbody tr')
    .evaluateAll(rows => rows.map((row, index) => {
      const cells = Array.from(row.querySelectorAll('td'));
      const status = cells[2] ? cells[2].cloneNode(true) : null;
      if (status) {
        status.querySelectorAll('a, button, input')
          .forEach(el => el.remove());
      }
      return {
        index,
        text: (row.innerText || '').replace(/\s+/g, ' ').trim(),
        date: cells[0] ? cells[0].innerText : '',
        status: status
          ? (status.textContent || '').replace(/\s+/g, ' ').trim()
          : '',
        detail: cells[3]
          ? cells[3].innerText.replace(/\s+/g, ' ').trim()
          : ''
      };
    }));
  const candidates = snapshots
    .map(row => ({
      ...row,
      key: exportDateKey(row.date)
    }))
    .filter(row =>
      row.key &&
      (
        !acc.exportRequestedAfter ||
        row.key >= acc.exportRequestedAfter
      )
    )
    .sort((a, b) => b.key.localeCompare(a.key));
  const latest = acc.exportRequestKey
    ? candidates.find(row => row.key === acc.exportRequestKey)
    : candidates[0];
  if (!latest) {
    acc.exportMissingCount = (acc.exportMissingCount || 0) + 1;
    if (
      acc.exportMissingCount === 1 ||
      acc.exportMissingCount % 5 === 0
    ) {
      console.log(
        `⚠️ 【${acc.name}】対象の取出予約が見つかりません。` +
        '画面パス: ' + new URL(page.url()).pathname +
        ' / 日時付き行数: ' + candidates.length
      );
    }
    if (acc.exportMissingCount >= 10) {
      throw new Error(
        '対象の取出予約を10回連続で取得できません。' +
        '画面遷移・一覧の表示を確認してください。'
      );
    }
    return {
      status: '不明',
      text: '',
      detail: '対象の取出予約を再取得中'
    };
  }
  acc.exportMissingCount = 0;
  acc.exportRequestKey = latest.key;
  const statusText = latest.status;
  let status = '不明';
  if (/進行中|出力中/.test(statusText)) {
    status = '進行中';
  } else if (/待機中/.test(statusText)) {
    status = '待機中';
  } else if (/キャンセル|失敗|エラー|中止/.test(statusText)) {
    status = 'キャンセル';
  } else if (/^(?:完了|取出完了|取出し完了|出力完了)$/.test(statusText)) {
    status = '完了';
  }
  console.log(
    `🔎 【${acc.name}】対象予約: ${latest.key}` +
    ` / ステータス: ${statusText}`
  );
  return {
    status,
    text: latest.text,
    detail: latest.detail,
    row: page.locator('table tbody tr').nth(latest.index)
  };
}
async function findDownloadLink(page, acc) {
  const target = await getLatestExportStatus(page, acc);
  if (target.status !== '完了' || !target.row) {
    return null;
  }
  page = target.row;
  const selectors = [
    'table tr:has(td) a[href*="/download/"]',
    'table tr:has(td) a[href*=".csv"]',
    'table tr:has(td) a:has-text("ダウンロード")',
    'a[href*="/download/"]',
    'a[href*=".csv"]',
    'a:has-text("ダウンロード")'
  ];
  for (const selector of selectors) {
    const links = page.locator(selector);
    const count = await links.count();
    for (let i = 0; i < count; i++) {
      const link = links.nth(i);
      if (await link.isVisible().catch(() => false)) {
        const href = await link.getAttribute('href')
          .catch(() => null);
        const text = await link.innerText()
          .catch(() => '');
        console.log(
          `🔎 ダウンロードリンク候補を検出: ${text.trim()} ${href || ''}`
        );
        return link;
      }
    }
  }
  const csvLinks = page.locator('a');
  const csvLinkCount = await csvLinks.count();
  for (let i = 0; i < csvLinkCount; i++) {
    const link = csvLinks.nth(i);
    if (!(await link.isVisible().catch(() => false))) {
      continue;
    }
    const href = await link.getAttribute('href')
      .catch(() => null);
    const text = await link.innerText()
      .catch(() => '');
    if (
      (
        href &&
        (
          href.includes('/download/') ||
          href.toLowerCase().includes('.csv')
        )
      ) ||
      text.trim().toLowerCase().endsWith('.csv')
    ) {
      console.log(
        `🔎 CSVダウンロードリンクを検出: ${text.trim()} ${href || ''}`
      );
      return link;
    }
  }
  return null;
}

async function downloadTargetCSVWithRetry(
  page,
  acc,
  downloadPath,
  historySegment
) {
  // 「完了」直後でもヒトマネ側のCSV実体がまだ準備中で
  // download URL が502/503/504になることがあるため、
  // ブラウザの同一ログインセッションでHTTP取得して待機・再試行する。
  const maxAttempts = 24;
  const baseWaitMs = 15000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(
      `⬇️ 【${acc.name}】CSVダウンロード試行 ${attempt}/${maxAttempts}`
    );
    try {
      if (attempt > 1) {
        await page.goto(
          acc.url.replace('/login/', '/' + historySegment),
          { waitUntil: 'domcontentloaded', timeout: 60000 }
        ).catch(() => {});
        await restoreExportSession(page, acc);
        await page.waitForTimeout(2000);
      }

      const downloadLink = await findDownloadLink(page, acc);
      if (!downloadLink) {
        throw new Error(
          '完成済み対象予約のダウンロードリンクを取得できませんでした。'
        );
      }

      const href = await downloadLink.getAttribute('href');
      if (!href) {
        throw new Error('対象CSVのダウンロードURLを取得できませんでした。');
      }
      const downloadUrl = new URL(href, page.url()).href;

      const response = await page.context().request.get(downloadUrl, {
        timeout: 120000,
        failOnStatusCode: false
      });
      const status = response.status();

      if ([429, 502, 503, 504].includes(status)) {
        const waitMs = Math.min(
          120000,
          baseWaitMs * Math.pow(1.35, attempt - 1)
        );
        console.log(
          `⏳ 【${acc.name}】ヒトマネ側CSV準備中/一時障害 HTTP ${status}。` +
          `${Math.round(waitMs / 1000)}秒後に同じ予約を再試行します。`
        );
        if (attempt >= maxAttempts) {
          throw new Error(
            `ヒトマネ側がHTTP ${status}を返し続けています。予約=${acc.exportRequestKey || '未取得'}`
          );
        }
        await page.waitForTimeout(waitMs);
        continue;
      }

      if (status === 401 || status === 403) {
        console.log(
          `🔐 【${acc.name}】CSV取得HTTP ${status}。再認証して同じ予約を再試行します。`
        );
        await page.goto(acc.url, {
          waitUntil: 'domcontentloaded',
          timeout: 60000
        }).catch(() => {});
        await restoreExportSession(page, acc);
        await page.waitForTimeout(5000);
        continue;
      }

      if (!response.ok()) {
        throw new Error(
          `CSV取得HTTPエラー: ${status} ${response.statusText()}`
        );
      }

      const body = await response.body();
      if (!body || body.length <= 0) {
        throw new Error('ダウンロードしたCSVファイルが空です。');
      }

      const contentType =
        (response.headers()['content-type'] || '').toLowerCase();
      if (contentType.includes('text/html')) {
        throw new Error(
          'CSVではなくHTMLが返されました。ログイン状態またはサーバー応答を再確認します。'
        );
      }

      fs.writeFileSync(downloadPath, body);
      const stat = fs.statSync(downloadPath);
      if (stat.size <= 0) {
        throw new Error('ダウンロードしたCSVファイルが空です。');
      }

      console.log(
        `✅ 【${acc.name}】RAWデータのダウンロード・保存成功（${stat.size} bytes）。`
      );
      return;
    } catch (error) {
      console.warn(
        `⚠️ 【${acc.name}】CSVダウンロード失敗（${attempt}/${maxAttempts}）: ${safeLog(error.message)}`
      );
      if (attempt >= maxAttempts) {
        throw new Error(
          `CSVダウンロードを${maxAttempts}回試行しましたが成功しませんでした。予約=${acc.exportRequestKey || '未取得'} / ${safeLog(error.message)}`
        );
      }
      const waitMs = Math.min(
        120000,
        baseWaitMs * Math.pow(1.35, attempt - 1)
      );
      console.log(
        `⏳ 【${acc.name}】${Math.round(waitMs / 1000)}秒待機して同じ予約=${acc.exportRequestKey || '未取得'}を再試行します。`
      );
      await page.waitForTimeout(waitMs);
    }
  }
}

async function downloadAndPrepareCSV(browser, acc) {
  logStage(acc, 'ブラウザ画面作成');
  const context = await browser.newContext({
    viewport: {
      width: 1280,
      height: 800
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on('response', response => {
    if (
      response.status() >= 400 &&
      response.request().isNavigationRequest()
    ) {
      console.warn(
        '[HTTPエラー] ' + acc.name +
        ' / ' + response.status() +
        ' / ' + safeLog(response.url())
      );
    }
  });
  page.on('dialog', async dialog => {
    console.log(
      `💬 【${acc.name}】ダイアログ検出: ${dialog.message()}`
    );
    await dialog.accept();
  });
  try {
    logStage(acc, 'ログイン');
    let loginSucceeded = false;
    let loginLastError = null;
    for (let loginAttempt = 1; loginAttempt <= 12; loginAttempt++) {
      try {
        console.log(
          `🔐 【${acc.name}】初回ログイン試行 ${loginAttempt}/12`
        );
        const response = await page.goto(acc.url, {
          waitUntil: 'domcontentloaded',
          timeout: 60000
        });

        const status = response ? response.status() : 0;
        if ([429, 502, 503, 504].includes(status)) {
          throw new Error(`ログインページ一時障害 HTTP ${status}`);
        }

        const userInput = page.locator(
          'input[type="text"], input[type="email"], input[name*="login"], input[name*="user"], input[name*="id"]'
        ).first();
        const passInput = page.locator('input[type="password"]').first();

        await userInput.waitFor({ state: 'visible', timeout: 30000 });
        await passInput.waitFor({ state: 'visible', timeout: 30000 });
        await userInput.fill(acc.id, { timeout: 30000 });
        await passInput.fill(acc.password, { timeout: 30000 });

        const submit = page.locator(
          'button[type="submit"], input[type="submit"], button:has-text("ログイン"), a:has-text("ログイン")'
        ).first();
        await submit.click({ force: true, timeout: 30000 });
        await page.waitForLoadState('domcontentloaded', {
          timeout: 30000
        }).catch(() => {});
        await page.waitForTimeout(2500);

        const stillLogin = await page.locator('input[type="password"]')
          .first().isVisible().catch(() => false);
        if (stillLogin) {
          const bodyText = await page.locator('body').innerText().catch(() => '');
          if (/認証|ログイン.*失敗|ID.*パスワード|パスワード.*(違|誤)|アカウント.*(ロック|無効)/i.test(bodyText)) {
            throw new Error(
              'ヒトマネ側でIDまたはパスワードが拒否されました。GitHub Secretsの認証情報確認が必要です。'
            );
          }
          throw new Error('ログイン送信後もログイン画面のままです。');
        }

        loginSucceeded = true;
        console.log(`✅ 【${acc.name}】ログイン成功。`);
        break;
      } catch (loginError) {
        loginLastError = loginError;
        console.warn(
          `⚠️ 【${acc.name}】初回ログイン失敗 ${loginAttempt}/12: ${safeLog(loginError.message)}`
        );

        if (/IDまたはパスワードが拒否/.test(loginError.message)) {
          throw loginError;
        }

        if (loginAttempt < 12) {
          const waitMs = Math.min(
            120000,
            15000 * Math.pow(1.35, loginAttempt - 1)
          );
          console.log(
            `⏳ 【${acc.name}】ヒトマネ側の復旧を${Math.round(waitMs / 1000)}秒待って再ログインします。`
          );
          await page.waitForTimeout(waitMs);
        }
      }
    }

    if (!loginSucceeded) {
      throw new Error(
        '初回ログインを12回試行しましたが成功しませんでした。' +
        (loginLastError ? ' 最終エラー: ' + safeLog(loginLastError.message) : '')
      );
    }
    logStage(acc, '募集一覧へ移動');
    const recruitUrl = acc.url.replace(
      '/login/',
      '/rec_recruitments'
    );
    await page.goto(recruitUrl, {
      waitUntil: 'networkidle'
    });
    logStage(acc, 'CSV取出予約');
    const exportBtn = page.locator(
      'a:has-text("ファイル取出予約"), ' +
      'button:has-text("ファイル取出予約")'
    ).first();
    await exportBtn.waitFor({
      state: 'visible',
      timeout: 30000
    });
    acc.exportRequestKey = null;
    acc.exportMissingCount = 0;
    acc.exportRequestedAfter = new Date(
      Date.now() - 60000 + 9 * 60 * 60 * 1000
    ).toISOString().slice(0, 19).replace(/\D/g, '');
    await exportBtn.click({ force: true });
    console.log(
      `✅ 【${acc.name}】ファイル取出予約を1回クリックしました。`
    );
    await page.waitForTimeout(3000);
    const historySegment = acc.name === 'B'
      ? 'csv_export_queues'
      : 'rec_export_histories';
    logStage(acc, '取出ファイル一覧へ移動');
    await navigateViaMenuOrUrl(
      page,
      acc,
      '取出ファイル一覧',
      historySegment
    );
    const maxWaitMs = 120 * 60 * 1000;
    const checkIntervalMs = 10000;
    const monitorStart = Date.now();
    let completed = false;
    logStage(acc, 'CSV出力完了の監視');
    while (!completed) {
      await page.reload({
        waitUntil: 'domcontentloaded',
        timeout: 60000
      }).catch(error => {
        console.warn(
          '[再読込失敗] ' + acc.name +
          ' / ' + safeLog(error.message)
        );
      });
      console.log(
        '[監視経過] ' + acc.name +
        ' / ' + Math.round((Date.now() - monitorStart) / 1000) + '秒' +
        ' / 予約=' + (acc.exportRequestKey || '未取得')
      );
      await page.waitForTimeout(1500);
      const result = await getLatestExportStatus(page, acc);
      if (result.status === '進行中') {
        console.log(
          `⚙️ 【${acc.name}】進行中: ${result.detail}`
        );
      } else if (result.status === '待機中') {
        console.log(
          `⏳ 【${acc.name}】待機中: 実行開始を待っています。`
        );
      } else if (result.status === '完了') {
        console.log(
          `✅ 【${acc.name}】対象予約のCSV取出しが完了しました。`
        );
        completed = true;
      } else if (result.status === 'キャンセル') {
        throw new Error(
          '管理画面側で対象の取出予約がキャンセル・失敗状態になりました。'
        );
      } else {
        console.log(
          `❓ 【${acc.name}】状態を特定できません。10秒後に再確認します。`
        );
      }
      if (Date.now() - monitorStart > maxWaitMs) {
        throw new Error(
          'CSV取出処理が120分経過しても完了しませんでした。'
        );
      }
      if (!completed) {
        await page.waitForTimeout(checkIntervalMs);
      }
    }
    await page.waitForTimeout(2000);
    logStage(acc, '対象CSVダウンロードリンク取得');
    let downloadLink = await findDownloadLink(page, acc);
    if (!downloadLink) {
      const linkWaitStart = Date.now();
      while (
        !downloadLink &&
        Date.now() - linkWaitStart < 60000
      ) {
        console.log(
          `⏳ 【${acc.name}】ダウンロードリンク反映待ち。`
        );
        await page.waitForTimeout(5000);
        await page.reload({
          waitUntil: 'domcontentloaded',
          timeout: 60000
        }).catch(() => {});
        await page.waitForTimeout(1000);
        downloadLink = await findDownloadLink(page, acc);
      }
    }
    if (!downloadLink) {
      throw new Error(
        'CSV取出しは完了しましたが、対象のダウンロードリンクを取得できませんでした。'
      );
    }
    logStage(acc, 'CSVダウンロード');
    const downloadPath = path.join(
      __dirname,
      `${acc.name}_raw_data.csv`
    );
    await downloadTargetCSVWithRetry(
      page,
      acc,
      downloadPath,
      historySegment
    );
    logStage(acc, 'CSV加工');
    const processed = processCSVFile(
      downloadPath,
      acc.name
    );
    if (!processed) {
      throw new Error(
        'CSVデータの加工に失敗しました。'
      );
    }
    logStage(acc, '取込準備完了');
    return {
      page,
      context,
      processed
    };
  } catch (error) {
    await logFailure(page, acc, error);
    console.log(
      `⚠️ 【${acc.name}】準備処理中にエラー: ${error.message}`
    );
    await page.screenshot({
      path: `error_prepare_${acc.name}.png`,
      fullPage: true
    }).catch(() => {});
    await context.close();
    throw error;
  }
}

async function executeNormalSet(
  page,
  acc,
  processed
) {
  console.log(
    `📦 【${acc.name}】通常版2ファイルを順番に送信します。`
  );
  await uploadSingleFileOnly(
    page,
    acc,
    processed.normal.path1,
    '①通常版・非掲載（先）'
  );
  await uploadSingleFileOnly(
    page,
    acc,
    processed.normal.path2,
    '②通常版・掲載（後）'
  );
  console.log(
    `🎉 【${acc.name}】通常版2ファイルのアップロード処理を送信しました。`
  );
}

async function executePvSet(
  page,
  acc,
  processed
) {
  console.log(
    `📦 【${acc.name}】PV版2ファイルを順番に送信します。`
  );
  await uploadSingleFileOnly(
    page,
    acc,
    processed.pv.path1,
    '③PV版・非掲載（先）'
  );
  await uploadSingleFileOnly(
    page,
    acc,
    processed.pv.path2,
    '④PV版・掲載（後）'
  );
  console.log(
    `🎉 【${acc.name}】PV版2ファイルのアップロード処理を送信しました。`
  );
}

(async () => {
  const counterPath = path.join(
    __dirname,
    'counter.json'
  );
  let counterData = {
    count: 0
  };
  try {
    if (fs.existsSync(counterPath)) {
      counterData = JSON.parse(
        fs.readFileSync(
          counterPath,
          'utf8'
        )
      );
    }
  } catch (e) {
    console.log(
      '⚠️ counter.json読み込み失敗。0から開始します。'
    );
    counterData = {
      count: 0
    };
  }
  const rotation = [
    'A_NORMAL',
    'A_PV',
    'B_NORMAL',
    'B_PV'
  ];
  const index =
    counterData.count % rotation.length;
  const currentState =
    rotation[index];
  let succeeded = false;
  let currentAcc = null;
  console.log(
    `🤖 現在のインデックス: ${index} → 今回の処理: ${currentState}`
  );
  const browser = await chromium.launch({
    headless: true
  });
  try {
    if (currentState === 'A_NORMAL') {
      currentAcc = accounts.find(
        a => a.name === 'A'
      );
      const result =
        await downloadAndPrepareCSV(
          browser,
          currentAcc
        );
      await executeNormalSet(
        result.page,
        currentAcc,
        result.processed
      );
      await result.context.close();
    } else if (
      currentState === 'A_PV'
    ) {
      currentAcc = accounts.find(
        a => a.name === 'A'
      );
      const result =
        await downloadAndPrepareCSV(
          browser,
          currentAcc
        );
      await executePvSet(
        result.page,
        currentAcc,
        result.processed
      );
      await result.context.close();
    } else if (
      currentState === 'B_NORMAL'
    ) {
      currentAcc = accounts.find(
        a => a.name === 'B'
      );
      const result =
        await downloadAndPrepareCSV(
          browser,
          currentAcc
        );
      await executeNormalSet(
        result.page,
        currentAcc,
        result.processed
      );
      await result.context.close();
    } else if (
      currentState === 'B_PV'
    ) {
      currentAcc = accounts.find(
        a => a.name === 'B'
      );
      const result =
        await downloadAndPrepareCSV(
          browser,
          currentAcc
        );
      await executePvSet(
        result.page,
        currentAcc,
        result.processed
      );
      await result.context.close();
    }
    succeeded = true;
    console.log(
      `🏁 ${currentState}の送信操作が終了しました。` +
      'サーバー取込完了は未検証です。'
    );
  } catch (err) {
    console.log(
      '❌ エラーが発生しました。' +
      '次回のスケジュール枠でも同じタスクを再実行します。: ' +
      err.message
    );
    await sendChatworkError(
      currentState,
      currentAcc,
      err
    );
    process.exitCode = 1;
  } finally {
    await browser.close();
    if (succeeded) {
      counterData.count =
        (index + 1) % rotation.length;
    } else {
      counterData.count = index;
    }
    try {
      fs.writeFileSync(
        counterPath,
        JSON.stringify(
          counterData,
          null,
          2
        ),
        'utf8'
      );
      console.log(
        `💾 次回インデックスを保存: ${counterData.count}` +
        ` / 次回: ${rotation[counterData.count]}`
      );
    } catch (writeErr) {
      console.log(
        `⚠️ counter.jsonの保存に失敗しました: ${writeErr.message}`
      );
    }
  }
})().catch(async error => {
  console.error(
    '[実行中断] ' +
    safeLog(error.message)
  );
  for (const acc of accounts) {
    if (acc.logStage) {
      console.error(
        '[最終工程] ' +
        acc.name +
        ' / ' +
        acc.logStage
      );
    }
  }
  await sendChatworkError(
    '実行中断',
    null,
    error
  );
  process.exitCode = 1;
});
