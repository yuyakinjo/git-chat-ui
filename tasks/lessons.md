# Lessons

- diff の強調表現は、行全体を濃く塗りつぶす前に、参照 UI と同程度の淡いバッジ強度で確認する
- ローカル運用の作業メモや計画ファイルを追加する前に、`tasks/` が `.gitignore` に入っているか確認する
- diff action の文言は、一覧だけか全差分かを正確に表す名前にする
- commit detail のような高密度 diff は常設せず、changed files から dialog で開く導線を優先する
- 複数パネルに同じ commit 情報を重複表示しない。責務を 1 箇所に寄せる
- Tauri/webview で確実に動かしたい内部 DnD は HTML5 `dataTransfer` ベースに寄せすぎない。branch list のような同一ペイン内操作は pointer ベースの内部 DnD を優先する
- DnD が機能しても完了扱いにしない。source、drop candidate、drop target、追従プレビューの少なくとも 2 つは見えるようにして、ドラッグ中の意図を UI で明示する
- DnD の方向性を見せたいときは target row を薄いハイライトだけで済ませず、`source -> target` が読める非対称な split preview に寄せる
