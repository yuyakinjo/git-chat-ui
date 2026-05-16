# branchTag span による Lane 予約と貫通縦線

## Status

accepted

## Context

`commitGraphLayout` は単一パスで各コミットに **Lane** を割り当てる。同じ **Branch** に属するコミットでも、**branch tip からの first-parent walk** で到達できない経路 (典型的には merge commit の second-parent 以降) を持つコミットは、別の `__anon__<sha>` タグになる。結果、視覚的には同一ブランチであるべきコミット群が、間に **Default chain** のコミットが挟まると **上下で別 Lane に分裂** して見えていた。Lane 番号も保証されておらず、上下が偶然同じ x 座標になっていただけで線が引かれていない状態。

## Decision

「**同じ branchTag のコミットは、間に何が挟まっても同一 Lane に乗せ、中央の Default chain コミット行でも縦線を貫通描画する**」というセマンティクスを採用し、以下を実装する:

1. **Branch coloring の拡張** (`commitGraphBranchColoring.ts`): branch tip からの walk を、辿る過程の merge commit の second-parent も**同じ branchTag** で再帰的に first-parent walk する。既に別 named tag が付いていれば停止し、**Default chain** には侵食しない。
2. **Branch tag span の pre-pass** (`commitGraphLayout.ts`): 各 branchTag の `firstRow`〜`lastRow` を事前計算する。
3. **Lane 予約** (`commitGraphLayout.ts`): span 期間中は `CLOSED_LANE_TOKEN` を打たず Lane を予約し続け、間の **Default chain** コミット行でも縦線を描画する。別 branchTag のコミットは予約 Lane を避けて別 Lane を取る。

## Considered alternatives

- **Coloring のみ拡張 (色だけ揃える)**: 中央の途切れは残るので、ユーザーの「途切れない」要件を満たさない。
- **Lane assignment 側で heuristic 一致**: branchTag を見ずに「作者+時間帯+メッセージ」で同 Lane 推定。誤検出が多く、Git のセマンティクスから外れる。
- **Reflog ベース walk**: force-push 前の過去コミットも救えるが、現状の「途切れ」原因の大部分は merge second-parent 経由で、reflog 依存は実装複雑度に見合わない。スコープ外。
- **Elbow (S 字曲線) で接続**: 中央を貫かず迂回曲線で繋ぐ案。GitKraken 等の慣習と異なり、複数同時分裂で線が交錯する。

## Consequences

- **Lane 数増加**: 並行する未マージブランチが多いリポジトリでは、span 重複により Lane が増える。Default chain と並列に複数縦線が常時走る景色を許容する。
- **Single-pass 前提が崩れる**: Lane assignment が pre-pass (branchTag span 計算) を必要とするため、コミット列に対して 2 パスになる。計算量は O(N)。
- **`__anon__` タグの役割縮小**: merge second-parent walk が named tag 配下に取り込まれるため、`__anon__` が出るのは「ブランチ tip から到達不能な merge source」だけになる。
