// ★デバッグ用：予期しないエラーが必ずログに出るようにする
process.on('unhandledRejection', (reason) => {
  console.log('🔥 [unhandledRejection] スクリプト内で捕捉されなかったエラーです:', reason);
  process.exitCode = 1;
});

process.on('uncaughtException', (err) => {
  console.log('🔥 [uncaughtException] スクリプト内で捕捉されなかった例外です:', err);
  process.exitCode = 1;
});

console.log('🚀 main.js の実行を開始しました。');

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

console.log('📦 モジュールの読み込みが完了しました。');

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
    if (parsed.length > 0 && parsed[0] !== '') rows.push(parsed);
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
    if (val && (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r'))) {
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

function generatePatternFiles(headerLine, targetRows, basePath, accountName, label) {
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
      if (partsB.length === 3) row[idxB] = `2019/${partsB[1]}/${partsB[2]}`;
    }
    
    if (row[idxC]) {
      const rawC = row[idxC].replace(/"/g, '').trim();
      const partsC = rawC.split('/');
      if (partsC.length === 3) row[idxC] = `2020/${partsC[1]}/${partsC[2]}`;
    }
    
    row[idxD] = '非掲載';
    return row;
  });

  const path1 = basePath.replace('.csv', `_${label}_pattern1.csv`);
  const content1 = [headerLine, ...pattern1Rows.map(toCSVLine)].join('\r\n');
  fs.writeFileSync(path1, iconv.encode(content1, 'Shift_JIS'));
  console.log(`✅ 【${accountName}】【${label}】パターン1 CSV保存完了(Shift_JIS): ${path1}`);

  const dates = getTargetDates();
  const pattern2BaseRows = targetRows.map(orgRow => {
    const row = [...orgRow];
    if (row[idxA]) {
      const currentA = row[idxA].replace(/"/g, '').trim();
      row[idxA] = currentA.replace(/(RB\d{3})\d{8}/, `$1${dates.flatToday}`);
    }
    row[idxB] = dates.hyphenToday;
    row[idxC] = dates.future10Years;
    row[idxD] = '掲載';
    return row;
  });

  if (pattern2BaseRows.length > 1) {
    const lastKValue = pattern2BaseRows[pattern2BaseRows.length - 1][idxK];
    for (let i = pattern2BaseRows.length - 1; i > 0; i--) {
      pattern2BaseRows[i][idxK] = pattern2BaseRows[i - 1][idxK];
    }
    pattern2BaseRows[0][idxK] = lastKValue;
    console.log(`🔄 【${accountName}】【${label}】K列（募集職種）のローテーション完了。`);
  }

  const path2 = basePath.replace('.csv', `_${label}_pattern2.csv`);
  const content2 = [headerLine, ...pattern2BaseRows.map(toCSVLine)].join('\r\n');
  fs.writeFileSync(path2, iconv.encode(content2, 'Shift_JIS'));
  console.log(`✅ 【${accountName}】【${label}】パターン2 CSV保存完了(Shift_JIS): ${path2}`);

  return { path1, path2 };
}

function processCSVFile(filePath, accountName) {
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️ 【${accountName}】ファイルが見つかりません: ${filePath}`);
    return null;
  }

  console.log(`🛠️ 【${accountName}】CSVの加工処理を開始します...`);
  
  const buffer = fs.readFileSync(filePath);
  const content = iconv.decode(buffer, 'Shift_JIS');
  
  const idxB = colNameToIndex('B');
  const idxGG = colNameToIndex('GG');
  const idxGH = colNameToIndex('GH');

  const { headerLine, rows: allRows } = parseCSVContentRobust(content);

  if (allRows.length === 0) return null;

  const normalFiltered = allRows.filter(row => {
    const valGG = row[idxGG] ? row[idxGG].replace(/"/g, '').trim() : '';
    const valGH = row[idxGH] ? row[idxGH].replace(/"/g, '').trim() : '';
    const isBothActive = (valGG !== '0' && valGG !== '') && (valGH !== '0' && valGH !== '');
    return !isBothActive; 
  });

  normalFiltered.sort((x, y) => {
    const dateX = x[idxB] ? x[idxB].replace(/"/g, '').trim() : '';
    const dateY = y[idxB] ? y[idxB].replace(/"/g, '').trim() : '';
    return new Date(dateX) - new Date(dateY);
  });

  const normalTargetRows = normalFiltered.slice(0, 3990);
  const normalFiles = generatePatternFiles(headerLine, normalTargetRows, filePath, accountName, 'normal');

  const pvSorted = [...allRows].sort((x, y) => {
    const valX = parseFloat(x[idxGH] ? x[idxGH].replace(/"/g, '').trim() : 0) || 0;
    const valY = parseFloat(y[idxGH] ? y[idxGH].replace(/"/g, '').trim() : 0) || 0;
    return valY - valX;
  });

  const pvSliced = pvSorted.slice(0, 3990);
  pvSliced.sort((x, y) => {
    const dateX = x[idxB] ? x[idxB].replace(/"/g, '').trim() : '';
    const dateY = y[idxB] ? y[idxB].replace(/"/g, '').trim() : '';
    return new Date(dateX) - new Date(dateY);
  });

  const pvFiles = generatePatternFiles(headerLine, pvSliced, filePath, accountName, 'pv');

  return { normal: normalFiles, pv: pvFiles };
}

async function navigateViaMenuOrUrl(page, acc, targetText, targetUrlSegment) {
  try {
    const menuHoverIcon = page.locator('li:has(a:has-text("面接カレンダー")) + li, ul.nav-tabs li:nth-child(5), .nav-tabs li a:has(img), li:has(.fa-refresh)').first();
    if (await menuHoverIcon.count() > 0) {
      await menuHoverIcon.hover();
      await page.waitForTimeout(1000);
      const subMenuLink = page.locator(`a:has-text("${targetText}")`).first();
      if (await subMenuLink.count() > 0 && await subMenuLink.isVisible()) {
        await subMenuLink.click();
        await page.waitForLoadState('networkidle').catch(() => {});
        return;
      }
    }
  } catch (err) {
  }

  const destinationUrl = acc.url.replace('/login/', `/${targetUrlSegment}`);
  await page.goto(destinationUrl, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function uploadSingleFileOnly(page, acc, fileToUpload, label) {
  console.log(`👉 【${acc.name}】[${label}] 募集一覧画面へ移動します...`);
  const recruitUrl = acc.url.replace('/login/', '/rec_recruitments');
  await page.goto(recruitUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});

  console.log(`👉 【${acc.name}】[${label}] 『ファイル取込予約』ボタンをクリックしてポップアップを開きます...`);
  const openModalBtn = page.locator('a:has-text("ファイル取込予約")').first();
  await openModalBtn.waitFor({ state: 'visible', timeout: 10000 });
  await openModalBtn.click({ force: true });
  
  await page.waitForTimeout(2000);

  console.log(`📤 【${acc.name}】[${label}] アップロード要素を探索中...`);
  let targetInput = null;
  let activeFrame = null; 

  const mainInput = page.locator('input[type="file"]').first();

  if (await mainInput.count() > 0) {
    targetInput = mainInput;
  } else {
    console.log(`🔍 【${acc.name}】[${label}] メインDOMに見つからないため、iframe内をスキャンします...`);

    const frames = page.frames();

    for (const frame of frames) {
      const frameInput = frame.locator('input[type="file"]').first();

      if (await frameInput.count() > 0) {
        targetInput = frameInput;
        activeFrame = frame; 
        console.log(`💡 【${acc.name}】[${label}] iframe内で input[type="file"] を検出しました。`);
        break;
      }
    }
  }

  if (targetInput) {
    await targetInput.setInputFiles(fileToUpload);
    console.log(`✅ 【${acc.name}】[${label}] input要素へのファイル注入に成功しました。`);
  } else {
    console.log(`⚠️ 【${acc.name}】[${label}] inputが見つかりません。直接クリックを試みます...`);

    const customUploadBtn = page.locator(
      'text=ファイルを選択, text=ファイル選択, button:has-text("選択"), .file-upload, .upload-area'
    ).first();

    if (await customUploadBtn.count() > 0) {
      customUploadBtn.click({ force: true }).catch(() => {});
    }

    const retryInput = page.locator('input[type="file"]').first();

    if (await retryInput.count() > 0) {
      await retryInput.setInputFiles(fileToUpload).catch(() => {});
    }
  }
  
  await page.waitForTimeout(1500);

  console.log(`🚀 【${acc.name}】[${label}] 青色の『ファイル取込予約』実行ボタンを確定します...`);
  
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
      console.log(`🎯 セレクター合致によりボタンを捕捉: ${selector}`);
      break;
    }
  }

  if (!targetClickBtn) {
    for (const f of page.frames()) {
      const el = f.locator(':text("ファイル取込予約")').last();

      if (await el.count() > 0) {
        targetClickBtn = el;
        break;
      }
    }
  }

  if (!targetClickBtn) {
    throw new Error("❌ 青い『ファイル取込予約』ボタンを画面上から特定できませんでした。");
  }

  console.log(`👆 【${acc.name}】[${label}] 青いエリアを物理クリック（強制）します...`);

  await targetClickBtn.scrollIntoViewIfNeeded({
    timeout: 5000
  }).catch(() => {});

  await targetClickBtn.click({
    force: true,
    timeout: 15000
  });

  console.log(`🚀 【${acc.name}】[${label}] クリックイベントの送信完了。`);
  
  console.log(`💤 サーバー側のバッファ確保のため、30秒間待機します...`);
  await page.waitForTimeout(30000);
}

async function downloadAndPrepareCSV(browser, acc) {
  const context = await browser.newContext({
    viewport: {
      width: 1280,
      height: 800
    }
  });

  const page = await context.newPage();

  page.setDefaultTimeout(0);

  page.on('dialog', async dialog => {
    console.log(`💬 【${acc.name}】ダイアログ検出: ${dialog.message()}`);
    await dialog.accept();
  });

  try {
    console.log(`👉 【${acc.name}】ログインページへ移動します: ${acc.url}`);

    await page.goto(acc.url, {
      waitUntil: 'networkidle'
    });

    await page.locator(
      'input[type="text"], input[type="email"], input[name*="login"]'
    ).first().fill(acc.id);

    await page.locator(
      'input[type="password"]'
    ).first().fill(acc.password);

    await page.locator(
      'button, input[type="submit"], .btn, a:has-text("ログイン")'
    ).first().click();

    await page.waitForLoadState('networkidle').catch(() => {});

    console.log(`✅ 【${acc.name}】ログイン処理を実行しました。`);

    const recruitUrl = acc.url.replace(
      '/login/',
      '/rec_recruitments'
    );

    await page.goto(recruitUrl, {
      waitUntil: 'networkidle'
    });

    console.log(`👉 【${acc.name}】「ファイル取出予約」を実行します（全求人対象）`);

    const exportBtn = page.locator(
      'a:has-text("ファイル取出予約"), button:has-text("ファイル取出予約")'
    ).first();

    await exportBtn.waitFor({
      state: 'visible',
      timeout: 30000
    });

    await exportBtn.click({
      force: true
    });

    await page.waitForTimeout(8000);

    const historySegment =
      (acc.name === 'B')
        ? "csv_export_queues"
        : "rec_export_histories";

    console.log(
      `👉 【${acc.name}】「取出ファイル一覧」画面へ移動します... (${historySegment})`
    );

    await navigateViaMenuOrUrl(
      page,
      acc,
      "取出ファイル一覧",
      historySegment
    );

    console.log(
      `⏳ 【${acc.name}】CSV抽出の完了を監視中... (10秒インターバル監視)`
    );

    // 最大3時間まで監視
    const MAX_WAIT_MS = 3 * 60 * 60 * 1000;

    // 10秒ごとに確認
    const POLL_INTERVAL_MS = 10000;

    const startTime = Date.now();

    let previousRowText = '';

    while (true) {

      // ------------------------------------------------------------
      // 最大待機時間
      // ------------------------------------------------------------

      if (Date.now() - startTime > MAX_WAIT_MS) {
        throw new Error(
          `CSV抽出の監視がタイムアウトしました（${MAX_WAIT_MS / 60000}分経過）。`
        );
      }

      await page.waitForTimeout(POLL_INTERVAL_MS);

      try {

        // ============================================================
        // ① ページを再読み込み
        // ============================================================

        console.log(
          `🔄 【${acc.name}】取出ファイル一覧を更新します...`
        );

        await page.reload({
          waitUntil: 'domcontentloaded',
          timeout: 30000
        }).catch(() => {});

        await page.waitForTimeout(2000);

        // ============================================================
        // ② メインページ＋iframeのすべてを確認
        // ============================================================

        const contexts = [
          page,
          ...page.frames().filter(
            frame => frame !== page.mainFrame()
          )
        ];

        let foundRows = [];

        // ============================================================
        // ③ table tr をすべて取得
        // ============================================================

        for (const ctx of contexts) {

          try {

            const tables = ctx.locator('table');

            const tableCount = await tables.count();

            for (let t = 0; t < tableCount; t++) {

              const table = tables.nth(t);

              const rows = table.locator('tr');

              const rowCount = await rows.count();

              for (let r = 0; r < rowCount; r++) {

                const row = rows.nth(r);

                const cells =
                  await row.locator('td').allTextContents();

                if (cells.length < 3) {
                  continue;
                }

                const cleanCells = cells.map(c =>
                  String(c || '')
                    .replace(/\s+/g, ' ')
                    .trim()
                );

                const rowText =
                  cleanCells.join(' ');

                if (!rowText) {
                  continue;
                }

                // 日付のある行を候補にする
                const firstCell =
                  cleanCells[0] || '';

                const isDateRow =
                  /^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/.test(firstCell) ||
                  /^\d{4}/.test(firstCell);

                // ステータスが入っている行も候補にする
                const hasStatus =
                  rowText.includes('進行中') ||
                  rowText.includes('完了') ||
                  rowText.includes('キャンセル') ||
                  rowText.includes('待機中') ||
                  rowText.includes('出力中');

                if (isDateRow || hasStatus) {

                  foundRows.push({
                    row,
                    cells: cleanCells,
                    text: rowText
                  });

                }

              }

            }

          } catch (tableError) {
            // 別のコンテキストを確認
          }

        }

        // ============================================================
        // ④ テーブルが取得できない場合はbody全体から検索
        // ============================================================

        if (foundRows.length === 0) {

          let bodyText = '';

          for (const ctx of contexts) {

            try {

              const text =
                await ctx.locator('body').innerText({
                  timeout: 5000
                }).catch(() => '');

              if (
                text &&
                text.length > bodyText.length
              ) {
                bodyText = text;
              }

            } catch (bodyError) {
              // 次へ
            }

          }

          if (bodyText) {

            const normalizedBody =
              bodyText
                .replace(/\r/g, '')
                .replace(/\u00a0/g, ' ');

            // --------------------------------------------------------
            // 完了
            // --------------------------------------------------------

            if (
              normalizedBody.includes('完了') ||
              normalizedBody.includes('.csv') ||
              normalizedBody.includes('.CSV')
            ) {

              console.log(
                `🔎 【${acc.name}】画面全体からCSV完了を検出しました。`
              );

              break;
            }

            // --------------------------------------------------------
            // キャンセル
            // --------------------------------------------------------

            if (
              normalizedBody.includes('キャンセル')
            ) {

              console.log(
                `⚠️ 【${acc.name}】画面全体からキャンセルを検出しました。`
              );

              throw new Error(
                `管理画面側で最新のリクエストが「キャンセル」されました。`
              );
            }

            // --------------------------------------------------------
            // 進行中
            // --------------------------------------------------------

            if (
              normalizedBody.includes('進行中') ||
              normalizedBody.includes('出力中')
            ) {

              const progressMatch =
                normalizedBody.match(
                  /\d[\d,]*\/\d[\d,]*件[^\n]*/
                );

              if (progressMatch) {

                console.log(
                  `⚙️ 【${acc.name}】現在のステータス: [進行中] (${progressMatch[0].trim()})`
                );

              } else {

                console.log(
                  `⚙️ 【${acc.name}】現在のステータス: [進行中]`
                );

              }

              continue;
            }

            // --------------------------------------------------------
            // 待機中
            // --------------------------------------------------------

            if (
              normalizedBody.includes('待機中')
            ) {

              console.log(
                `⏳ 【${acc.name}】現在のステータス: [待機中]`
              );

              continue;
            }

          }

          console.log(
            `❓ 【${acc.name}】ステータスを含むテーブル行を取得できませんでした。次回更新時に再確認します。`
          );

          continue;
        }

        // ============================================================
        // ⑤ 最新行を決定
        // ============================================================

        // 画面上の上側にある行を優先
        // 同じ日付形式なら先頭を最新行として扱う

        const latest =
          foundRows[0];

        const latestRowText =
          latest.text;

        // 同じ内容を何度もログに出さない
        if (
          latestRowText !== previousRowText
        ) {

          console.log(
            `🔎 【${acc.name}】最新行: ${latestRowText}`
          );

          previousRowText =
            latestRowText;
        }

        // ============================================================
        // ⑥ キャンセル
        // ============================================================

        if (
          latestRowText.includes('キャンセル')
        ) {

          throw new Error(
            `管理画面側で最新のリクエストが「キャンセル」されました。`
          );
        }

        // ============================================================
        // ⑦ 完了
        // ============================================================

        if (
          latestRowText.includes('完了') ||
          latestRowText.includes('.csv') ||
          latestRowText.includes('.CSV') ||
          latestRowText.includes('成功')
        ) {

          console.log(
            `✅ 【${acc.name}】CSVの生成完了を確認しました！`
          );

          console.log(
            `📄 【${acc.name}】完了行: ${latestRowText}`
          );

          break;
        }

        // ============================================================
        // ⑧ 進行中
        // ============================================================

        if (
          latestRowText.includes('進行中') ||
          latestRowText.includes('出力中')
        ) {

          const progressMatch =
            latestRowText.match(
              /\d[\d,]*\/\d[\d,]*件[^\s]*/
            );

          const remainingMatch =
            latestRowText.match(
              /残り約[^\s]+/
            );

          let detailLog =
            'データ出力中';

          if (progressMatch) {
            detailLog =
              progressMatch[0];
          }

          if (remainingMatch) {
            detailLog +=
              ` ${remainingMatch[0]}`;
          }

          console.log(
            `⚙️ 【${acc.name}】現在のステータス: [進行中] (${detailLog})`
          );

          continue;
        }

        // ============================================================
        // ⑨ 待機中
        // ============================================================

        if (
          latestRowText.includes('待機中')
        ) {

          console.log(
            `⏳ 【${acc.name}】現在のステータス: [待機中]`
          );

          continue;
        }

        // ============================================================
        // ⑩ ステータス不明
        // ============================================================

        console.log(
          `❓ 【${acc.name}】最新行は取得できましたが、ステータスを判定できません。`
        );

        console.log(
          `   【${acc.name}】行内容: ${latestRowText}`
        );

      } catch (e) {

        if (
          e.message.includes('キャンセル') ||
          e.message.includes('タイムアウト')
        ) {
          throw e;
        }

        console.log(
          `⚠️ 【${acc.name}】監視中に一時的なエラーが発生しました。次回更新時に再試行します: ${e.message}`
        );

      }

    }

    // ================================================================
    // ⑪ CSVダウンロードリンクを取得
    // ================================================================

    console.log(
      `👉 【${acc.name}】画面の切り替わりを2秒待機したあと、ダウンロードリンクを捕捉します...`
    );

    await page.waitForTimeout(2000);

    let downloadLink = null;

    const downloadContexts = [
      page,
      ...page.frames().filter(
        frame => frame !== page.mainFrame()
      )
    ];

    const downloadSelectors = [
      'a[href*=".csv"]',
      'a[href*=".CSV"]',
      'a:has-text("ダウンロード")',
      'a:has-text("CSV")',
      'button:has-text("ダウンロード")'
    ];

    for (const ctx of downloadContexts) {

      for (const selector of downloadSelectors) {

        try {

          const link =
            ctx.locator(selector).first();

          if (
            await link.count() > 0
          ) {

            downloadLink = link;
            break;

          }

        } catch (e) {
          // 次のセレクターへ
        }

      }

      if (downloadLink) {
        break;
      }

    }

    // ================================================================
    // ⑫ リンクが見つからない場合はページ内の全リンクを確認
    // ================================================================

    if (!downloadLink) {

      for (const ctx of downloadContexts) {

        try {

          const links =
            ctx.locator('a');

          const linkCount =
            await links.count();

          for (let i = 0; i < linkCount; i++) {

            const link =
              links.nth(i);

            const text =
              (
                await link.innerText().catch(() => '')
              ).trim();

            const href =
              await link.getAttribute('href').catch(() => '');

            if (
              text.includes('ダウンロード') ||
              text.includes('CSV') ||
              (href && (
                href.includes('.csv') ||
                href.includes('.CSV')
              ))
            ) {

              downloadLink =
                link;

              console.log(
                `🎯 【${acc.name}】ダウンロードリンクを検出: ${text} ${href || ''}`
              );

              break;
            }

          }

        } catch (e) {
          // 次のコンテキストへ
        }

        if (downloadLink) {
          break;
        }

      }

    }

    if (!downloadLink) {
      throw new Error(
        "CSVのダウンロードリンクを特定できませんでした。"
      );
    }

    console.log(
      `👉 【${acc.name}】ダウンロードを開始します...`
    );

    const [download] =
      await Promise.all([
        page.waitForEvent('download', {
          timeout: 60000
        }),
        downloadLink.click({
          force: true
        })
      ]);

    const downloadPath =
      path.join(
        __dirname,
        `${acc.name}_raw_data.csv`
      );

    await download.saveAs(
      downloadPath
    );

    console.log(
      `✅ 【${acc.name}】RAWデータのダウンロード・保存に成功しました！`
    );

    const processed =
      processCSVFile(
        downloadPath,
        acc.name
      );

    if (!processed) {
      throw new Error(
        "CSVデータの加工に失敗しました。"
      );
    }

    return {
      page,
      context,
      processed
    };

  } catch (error) {

    console.log(
      `⚠️ 【${acc.name}】準備処理中にエラーが発生: ${error.message}`
    );

    await page.screenshot({
      path: `error_prepare_${acc.name}.png`,
      fullPage: true
    }).catch(() => {});

    await context.close();

    throw error;
  }
}

async function executeNormalSet(page, acc, processed) {
  console.log(`📦 【${acc.name}】[通常版] 2ファイル連続アップロード（30秒インターバル）を実行します。`);

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

async function executePvSet(page, acc, processed) {
  console.log(`📦 【${acc.name}】[PV版] 2ファイル連続アップロード（30秒インターバル）を実行します。`);

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

// 🏁 起動回数ベース永久ローテーション制御
(async () => {
  console.log('🏗️ メイン処理（IIFE）に入りました。');

  const counterPath =
    path.join(__dirname, 'counter.json');

  let counterData = {
    count: 0
  };

  try {

    if (fs.existsSync(counterPath)) {

      counterData =
        JSON.parse(
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

  console.log(
    `🤖 現在のインデックス: ${index} → 今回の処理: 【${currentState}】`
  );

  let browser;

  try {

    console.log(
      '🌐 ブラウザを起動します...'
    );

    browser =
      await chromium.launch({
        headless: true
      });

    console.log(
      '✅ ブラウザの起動に成功しました。'
    );

    if (
      currentState === 'A_NORMAL'
    ) {

      const acc =
        accounts.find(
          a => a.name === 'A'
        );

      const result =
        await downloadAndPrepareCSV(
          browser,
          acc
        );

      await executeNormalSet(
        result.page,
        acc,
        result.processed
      );

      await result.context.close();

    } else if (
      currentState === 'A_PV'
    ) {

      const acc =
        accounts.find(
          a => a.name === 'A'
        );

      const result =
        await downloadAndPrepareCSV(
          browser,
          acc
        );

      await executePvSet(
        result.page,
        acc,
        result.processed
      );

      await result.context.close();

    } else if (
      currentState === 'B_NORMAL'
    ) {

      const acc =
        accounts.find(
          a => a.name === 'B'
        );

      const result =
        await downloadAndPrepareCSV(
          browser,
          acc
        );

      await executeNormalSet(
        result.page,
        acc,
        result.processed
      );

      await result.context.close();

    } else if (
      currentState === 'B_PV'
    ) {

      const acc =
        accounts.find(
          a => a.name === 'B'
        );

      const result =
        await downloadAndPrepareCSV(
          browser,
          acc
        );

      await executePvSet(
        result.page,
        acc,
        result.processed
      );

      await result.context.close();

    }

    console.log(
      `🏁 【${currentState}】の処理が正常に完了しました。`
    );

  } catch (err) {

    console.log(
      `❌ エラーが発生しました。次回のスケジュール枠では次のタスクに進みます。: ${err && err.stack ? err.stack : err}`
    );

    process.exitCode = 1;

  } finally {

    if (browser) {

      await browser.close().catch(() => {});

    }

    counterData.count =
      (index + 1) % rotation.length;
    
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
        `💾 次回インデックスを保存しました: ${counterData.count} (次は 【${rotation[counterData.count]}】)`
      );

    } catch (writeErr) {

      console.log(
        `⚠️ counter.jsonの保存に失敗しました: ${writeErr.message}`
      );

    }

  }

  console.log(
    '🔚 main.js の全処理が終了しました。'
  );

})();
