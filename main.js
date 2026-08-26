    console.log(`👉 【${acc.name}】ダウンロードを開始します...`);

    let download = null;
    let lastDownloadError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`🔄 【${acc.name}】ダウンロード試行 ${attempt}/3`);

        if (attempt > 1) {
          await page.waitForTimeout(3000);

          const retryLink = page.locator('table tr:has(td) a[href*=".csv"], table tr:has(td) a:has-text("ダウンロード"), td a, td button').first();

          if (await retryLink.count() > 0) {
            downloadLink = retryLink;
          } else {
            const fallbackRetryLink = page.locator('a[href*=".csv"], a:has-text("ダウンロード")').first();
            if (await fallbackRetryLink.count() > 0) {
              downloadLink = fallbackRetryLink;
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
