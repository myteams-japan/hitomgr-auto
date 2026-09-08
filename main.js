const { chromium } = require('playwright');
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
    const customUploadBtn = page.locator('text=ファイルを選択, text=ファイル選択, button:has-text("選択"), .file-upload, .upload-area').first();
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
  await targetClickBtn.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  await targetClickBtn.click({ force: true, timeout: 15000 });
  console.log(`🚀 【${acc.name}】[${label}] クリックイベントの送信完了。`);
  
  console.log(`💤 サーバー側のバッファ確保のため、30秒間待機します...`);
  await page.waitForTimeout(30000);
}

async function downloadAndPrepareCSV(browser, acc) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.setDefaultTimeout(0); 

  page.on('dialog', async dialog => {
    console.log(`💬 【${acc.name}】ダイアログ検出: ${dialog.message()}`);
    await dialog.accept();
  });

  try {
    await page.goto(acc.url, { waitUntil: 'networkidle' }); 
    await page.locator('input[type="text"], input[type="email"], input[name*="login"]').first().fill(acc.id);
    await page.locator('input[type="password"]').first().fill(acc.password);
    await page.locator('button, input[type="submit"], .btn, a:has-text("ログイン")').first().click();
    await page.waitForLoadState('networkidle').catch(() => {});

    const recruitUrl = acc.url.replace('/login/', '/rec_recruitments');
    await page.goto(recruitUrl, { waitUntil: 'networkidle' });

    console.log(`👉 【${acc.name}】「ファイル取出予約」を実行します（全求人対象）`);
    const exportBtn = page.locator('a:has-text("ファイル取出予約"), button:has-text("ファイル取出予約")').first();
    await exportBtn.waitFor({ state: 'visible', timeout: 30000 });
    await exportBtn.click({ force: true });
    await page.waitForTimeout(8000);

    const historySegment = (acc.name === 'B') ? "csv_export_queues" : "rec_export_histories";
    console.log(`👉 【${acc.name}】「取出ファイル一覧」画面へ移動します... (${historySegment})`);
    await navigateViaMenuOrUrl(page, acc, "取出ファイル一覧", historySegment);

    console.log(`⏳ 【${acc.name}】CSV抽出の完了を監視中... (10秒インターバル監視)`);

    // 🔄 HTML構造に依存せず、画面全体の文字要素から現在のステータスを追うロジック
    while (true) {
      await page.waitForTimeout(10000);

      try {
        const pageText = await page.evaluate(() => document.body.innerText || "");
        const lines = pageText.split('\n').map(l => l.trim()).filter(Boolean);

        let isCompleted = false;
        let statusFound = false;

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes('リクエスト日時') && lines[i].includes('データ種別')) {
            const scanArea = lines.slice(i + 1, i + 8).join(' ');

            // 1. 【最優先】最新リクエストの生成完了判定
            if (scanArea.includes('完了') || scanArea.includes('.csv')) {
              console.log(`✅ 【${acc.name}】CSVの生成完了を確認しました！`);
              statusFound = true;
              isCompleted = true;
              break;
            } 
            
            // 2. 【二優先】最新リクエストの「進行中・出力中」判定
            else if (scanArea.includes('進行中') || scanArea.includes('出力中')) {
              // 進捗件数を抽出 (例: 30300/30348件出力中)
              const progressMatch = scanArea.match(/\d+\/\d+件(出力中|進行中)/);
              // 残り時間を抽出 (例: 残り約16分39秒、残り約2秒、残り約5分 いずれにも対応)
              const timeMatch = scanArea.match(/残り約(\d+分)?(\d+秒)?/);
              
              let detailLog = '';
              if (progressMatch) {
                detailLog = progressMatch[0];
                // 残り時間テキストが存在し、かつ「残り約」だけで終わっていない場合のみ結合
                if (timeMatch && timeMatch[0] !== '残り約') {
                  detailLog += ` ${timeMatch[0]}`;
                }
              } else {
                const fallbackMatch = scanArea.match(/\d+\/\d+件[^\s]*/);
                detailLog = fallbackMatch ? fallbackMatch[0] : 'データ出力中';
              }
              
              console.log(`⚙️ 【${acc.name}】現在のステータス: [進行中] (${detailLog})`);
              statusFound = true;
              break; 
            } 
            
            // 3. 【三優先】最新リクエストの「待機中」判定
            else if (scanArea.includes('待機中')) {
              console.log(`⏳ 【${acc.name}】現在のステータス: [待機中] (実行までしばらくお待ち下さい)`);
              statusFound = true;
              break; 
            }

            // 4. 【最終フォールバック】単一で「キャンセル」状態になっている場合のみエラー判定
            else if (scanArea.includes('キャンセル')) {
              throw new Error(`管理画面側でリクエストが「キャンセル」されました。`);
            }
          }
        }

        // 「完了」ステータスをしっかり掴んだ時だけ監視ループをブレイクして次へ進む
        if (isCompleted) {
          break;
        }

        if (!statusFound) {
          console.log(`❓ 【${acc.name}】ステータス文字が特定できません。自動リロードを待ちます...`);
        }

      } catch (e) {
        if (e.message.includes('キャンセル')) throw e;
        console.log(`⚠️ 【${acc.name}】監視ループ内で一時的なエラー（自動リロードと重複）: ${e.message}`);
      }
    }

    console.log(`👉 【${acc.name}】画面の切り替わりを2秒待機したあと、ダウンロードリンクを捕捉します...`);
    await page.waitForTimeout(2000); 
    
    let downloadLink = page.locator('table tr:has(td) a[href*=".csv"], table tr:has(td) a:has-text("ダウンロード"), td a, td button').first();

    if (!downloadLink || (await downloadLink.count()) === 0) {
      downloadLink = page.locator('a[href*=".csv"], a:has-text("ダウンロード")').first();
    }

    if (!downloadLink || (await downloadLink.count()) === 0) {
      throw new Error("CSV of download link cannot be specified.");
    }

    console.log(`👉 【${acc.name}】ダウンロードを開始します...`);
    
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }), 
      downloadLink.click({ force: true })
    ]);
    
    const downloadPath = path.join(__dirname, `${acc.name}_raw_data.csv`);
    await download.saveAs(downloadPath);
    console.log(`✅ 【${acc.name}】RAWデータのダウンロード・保存に成功しました！`);

    const processed = processCSVFile(downloadPath, acc.name);
    if (!processed) throw new Error("CSVデータの加工に失敗しました。");

    return { page, context, processed };
  } catch (error) {
    console.log(`⚠️ 【${acc.name}】準備処理中にエラーが発生: ${error.message}`);
    await page.screenshot({ path: `error_prepare_${acc.name}.png`, fullPage: true });
    await context.close();
    throw error;
  }
}

async function executeNormalSet(page, acc, processed) {
  console.log(`📦 【${acc.name}】[通常版] 2ファイル連続アップロード（30秒インターバル）を実行します。`);
  await uploadSingleFileOnly(page, acc, processed.normal.path1, '①通常版・非掲載（先）');
  await uploadSingleFileOnly(page, acc, processed.normal.path2, '②通常版・掲載（後）');
  console.log(`🎉 【${acc.name}】通常版2ファイルのアップロード処理を送信しました。`);
}

async function executePvSet(page, acc, processed) {
  console.log(`📦 【${acc.name}】[PV版] 2ファイル連続アップロード（30秒インターバル）を実行します。`);
  await uploadSingleFileOnly(page, acc, processed.pv.path1, '③PV版・非掲載（先）');
  await uploadSingleFileOnly(page, acc, processed.pv.path2, '④PV版・掲載（後）');
  console.log(`🎉 【${acc.name}】PV版2ファイルのアップロード処理を送信しました。`);
}

// 🏁 起動回数ベース永久ローテーション制御
(async () => {
  const counterPath = path.join(__dirname, 'counter.json');
  let counterData = { count: 0 };

  try {
    if (fs.existsSync(counterPath)) {
      counterData = JSON.parse(fs.readFileSync(counterPath, 'utf8'));
    }
  } catch (e) {
    console.log('⚠️ counter.json読み込み失敗。0から開始します。');
    counterData = { count: 0 };
  }

  const rotation = ['A_NORMAL', 'A_PV', 'B_NORMAL', 'B_PV'];
  
  const index = counterData.count % rotation.length;
  const currentState = rotation[index];

  console.log(`🤖 現在のインデックス: ${index} → 今回の処理: 【${currentState}】`);

  const browser = await chromium.launch({ headless: true });

  try {
    if (currentState === 'A_NORMAL') {
      const acc = accounts.find(a => a.name === 'A');
      const result = await downloadAndPrepareCSV(browser, acc);
      await executeNormalSet(result.page, acc, result.processed);
      await result.context.close();

    } else if (currentState === 'A_PV') {
      const acc = accounts.find(a => a.name === 'A');
      const result = await downloadAndPrepareCSV(browser, acc);
      await executePvSet(result.page, acc, result.processed);
      await result.context.close();

    } else if (currentState === 'B_NORMAL') {
      const acc = accounts.find(a => a.name === 'B');
      const result = await downloadAndPrepareCSV(browser, acc);
      await executeNormalSet(result.page, acc, result.processed);
      await result.context.close();

    } else if (currentState === 'B_PV') {
      const acc = accounts.find(a => a.name === 'B');
      const result = await downloadAndPrepareCSV(browser, acc);
      await executePvSet(result.page, acc, result.processed);
      await result.context.close();
    }

    console.log(`🏁 【${currentState}】の処理が正常に完了しました。`);

  } catch (err) {
    console.log(`❌ エラーが発生しました。次回のスケジュール枠では次のタスクに進みます。: ${err.message}`);
    process.exitCode = 1;

  } finally {
    await browser.close();

    counterData.count = (index + 1) % rotation.length;
    
    try {
      fs.writeFileSync(counterPath, JSON.stringify(counterData, null, 2), 'utf8');
      console.log(`💾 次回インデックスを保存しました: ${counterData.count} (次は 【${rotation[counterData.count]}】)`);
    } catch (writeErr) {
      console.log(`⚠️ counter.jsonの保存に失敗しました: ${writeErr.message}`);
    }
  }
})();
