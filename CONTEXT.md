# Git Chat UI

Git GUI デスクトップアプリ（Tauri + React）の語彙。コミットグラフ表示まわりの用語が中心。

## Language

### Commit graph

**Commit graph**:
左側に縦に並ぶコミット履歴の視覚化。ノード（コミット）とエッジ（親子関係の線）から成る。
_Avoid_: history view, log graph

**Lane**:
コミットグラフの「縦の列（x 座標スロット）」。各コミットはちょうど 1 つの **Lane** に乗る。
_Avoid_: column, track

**Default chain**:
**Default branch**（例: main）の tip から first-parent で辿れる **Commit** 列。**Lane** 0 に固定される。
_Avoid_: main line, trunk

**branchTag**:
**Commit** に付与される識別子。同じ **branchTag** を持つ **Commit** 同士は、同一 **Lane** に乗ることが期待される。3 種類: 名前付き（`refs/heads/...`）、merge 第2親以降の匿名チェーン（`__anon__<sha>`）、孤児チェーン（`__orphan__<sha>`）。
_Avoid_: branch color, lane id, group

**Branch coloring**:
**Commit** に **branchTag** を割り振る処理。branch tip からの first-parent walk + merge commit の second-parent への再帰 walk で決まる。
_Avoid_: tagging, classification

**Branch tag span**:
ある **branchTag** が **Commit graph** 上に出現する `firstRow` 〜 `lastRow` の行範囲。**Lane reservation** の単位。
_Avoid_: tag range, branch extent

**Lane reservation**:
ある **branchTag** の **Branch tag span** 内では、その **branchTag** 専用の **Lane** を確保し続け、中央の **Default chain** **Commit** 行でも縦線を描画する仕組み。
_Avoid_: lane pinning, lane lock

## Relationships

- 各 **Commit** はちょうど 1 つの **branchTag** を持つ
- 各 **Commit** はちょうど 1 つの **Lane** に乗る
- 各 **branchTag** はちょうど 1 つの **Branch tag span** を持つ
- 同じ **branchTag** の **Commit** は、**Branch tag span** の範囲内で、視覚的に同一 **Lane** （同じ x 座標）に乗る
- **Default chain** は常に **Lane** 0
- **Lane reservation** は別 **branchTag** の **Commit** より優先される (別 **branchTag** は予約 **Lane** を避ける)

## Example dialogue

> **Dev:** "feat/foo の **Commit** が上下で分裂して見えるんだけど、これは **Lane** の問題？ それとも **Branch coloring** の問題？"
> **Domain expert:** "まず両方の **Commit** が同じ **branchTag** を持っているか見て。同じなら **Lane** 割り当ての問題、違うなら **Branch coloring** の問題。"
