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
      `❌ エラーが発生しました。次回のスケジュール枠では次のタスクに進みます。: ${err.message}`
    );

    process.exitCode = 1;

  } finally {

    await browser.close();

    counterData.count =
      (index + 1) %
      rotation.length;
    
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

})();
