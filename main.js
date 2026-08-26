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

    let download = null;
    let lastDownloadError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`🔄 【${acc.name}】ダウンロード試行 ${attempt}/3`);

        if (attempt > 1) {
          await page.waitForTimeout(3000);

          let retryLink = page.locator('table tr:has(td) a[href*=".csv"], table tr:has(td) a:has-text("ダウンロード"), td a, td button').first();

          if (await retryLink.count() > 0) {
            downloadLink = retryLink;
          } else {
            retryLink = page.locator('a[href*=".csv"], a:has-text("ダウンロード")').first();

            if (await retryLink.count() > 0) {
              downloadLink = retryLink;
            }
          }

          await downloadLink.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
        }

        [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 60000 }),
          downloadLink.click({ force: true })
        ]);

        if (download) {
          console.log(`✅ 【${acc.name}】ダウンロードイベントを正常に検知しました。`);
          break;
        }

      } catch (downloadError) {
        lastDownloadError = downloadError;

        console.log(`⚠️ 【${acc.name}】ダウンロード試行 ${attempt}/3 に失敗しました: ${downloadError.message}`);

        if (attempt < 3) {
          console.log(`⏳ 【${acc.name}】3秒後にダウンロードを再試行します...`);
        }
      }
    }

    if (!download) {
      throw lastDownloadError || new Error("CSVのダウンロードに失敗しました。");
    }

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
