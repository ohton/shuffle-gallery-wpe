**概要**

- **目的**: PiGallery2 をバックエンドにしたランダム画像・動画のスライドショーを Wallpaper Engine 用に表示する Web 型壁紙です。
- **特徴**: PiGallery2 の `/pgapi/gallery/content/...` とプロジェクト内の `app.js` の情報API (`convertinfoapiurl`) を使ってランダムメディアを取得し、画像はクロスフェード、動画は自動再生で表示します。

**要件**

- **バックエンド**: PiGallery2（拡張機能で情報提供する `/info/` エンドポイントが必要）。
- **クライアント**: Wallpaper Engine（Web 型壁紙をサポートする環境）。
- **ブラウザライブラリ**: `exif-js` と `leaflet`（CDN で読み込まれています、`index.html` を参照）。

- **ブラウザライブラリ**: `leaflet`（CDN で読み込まれています、`index.html` を参照）。
- **追加バックエンド（Info API プロキシ）**: 本クライアントは PiGallery2 へ直接検索クエリを組み立ててアクセスするのではなく、前段に軽量なプロキシを置くことを想定しています。`app.js` の `convertinfoapiurl`（デフォルト `http://localhost:8000/info/`）はそのプロキシを叩き、JSON で PiGallery2 の Info エンドポイントのフル URL（例: `/pgapi/gallery/random/<encoded_query>/info`）を返す必要があります。

Wallpaper Engine用に作成したものですが、index.htmlとapp.jsで構成された単なるwebページなので、webブラウザで開いても動作します。というかWallpaper Engineでは動画がwebmしか再生できない、GPU負荷が結構上がるなどあるのでwebブラウザで全画面表示した方がデジタルフォトフレーム動作としては良いかも。

バックエンドのPiGallery2の情報API機能拡張は [pigallery2-random-info-extension](https://github.com/ohton/pigallery2-random-info-extension) を想定しています。追加バックエンド（Info API プロキシ）はPiGallery2の機能拡張にできないか検討中なので未公開です。単にクエリ部分を組み立ててjsonを返すだけなので、どんな実装でも良いです。

```python
qdic = json.loads(json_query)
query = quote(json.dumps(qdic, separators=(',',':')))
return JsonResponse({"url": f"http://{domain}/pgapi/gallery/random/{query}"})
```

**セットアップ**

- **PiGallery2 の準備**: PiGallery2 を動作させ、同一ネットワークまたは `localhost` でアクセス可能にしておいてください。`app.js` の `convertinfoapiurl` は既定で `http://localhost:8000/info/` に設定されています。
- **API の動作確認**: ブラウザから `http://<pi-gallery-host>:<port>/info/<some-id>` が JSON で返ることを確認してください。
- **WallPaper Engine での配置**: 本フォルダを Wallpaper Engine のプロジェクトとして読み込みます（`index.html` と `app.js` があるディレクトリ）。

**設定**

- **API エンドポイント変更**: バックエンドのホスト/ポートを変更する場合は `app.js` 内の先頭付近にある `convertinfoapiurl` を書き換えてください。
	- 例: `const convertinfoapiurl = 'http://192.168.1.10:8000/info/';`
- **表示設定**: オーバーレイ表示やメタデータ表示は画面右上の設定ボタン（`index.html` の UI）で切り替えられます。
 - **表示設定**: オーバーレイ表示やメタデータ表示は画面左上の設定ボタン（`index.html` の UI）で切り替えられます。

**使い方**

- Wallpaper Engine でプロジェクトを選択して起動すると、自動で PiGallery2 からランダム項目を取得してスライドショー表示します。
- 画像は自動でクロスフェード、動画はメタデータに基づいて再生長を調整します（短い動画はフォールバック時間を採用）。

**ファイル構成（主要）**

- **`index.html`**: Web 型壁紙のエントリ。レイアウト、CDN 読み込み、DOM 要素を定義します。
- **`app.js`**: 壁紙ロジック本体。PiGallery2 の API 呼び出し、メディア URL 組み立て、再生/フェード制御、EXIF/Leaflet 表示を実装しています。
- **`project.json`**: Wallpaper Engine 用のプロジェクトメタ情報（タイトル等）。

**実装メモ**

- `app.js` は PiGallery2 の `pgapi/gallery/content/<path>` を使って配信されるコンテンツを参照します。画像ファイルは可能な場合 `/1080` 変換 URL を要求して Web 向けに変換された出力を受け取ります。
- メタ情報は Info API (`infoMetadata`) から取得し、位置情報表示には `leaflet` を使用します（`index.html` で CDN 読み込み済み）。

**トラブルシュート**

- メディアが読み込めない場合: ブラウザの開発者コンソールで `convertinfoapiurl` に対するリクエストとレスポンスを確認してください。
- CORS エラーが出る場合: PiGallery2 側で適切な CORS 設定を有効にしてください。

**追加バックエンド（Info API プロキシ）**

このプロジェクトは PiGallery2 の Info API を直接叩くのではなく、前段に「Info API の URL を返す」軽量なプロキシ（または選定サービス）を置くことを想定しています。`app.js` の `convertinfoapiurl`（デフォルト `http://localhost:8000/info/`）はそのプロキシを呼び、JSON で Info API のフル URL を受け取ります。

目的:
- 検索クエリや選択ロジック（ランダム、タグ絞り込み、重み付けなど）をプロキシ側で実装できる。
- PiGallery2 の内部 API（例: `/pgapi/gallery/random/<検索クエリ>/info`）へのパスを隠蔽し、クライアント側コードをシンプルに保つ。

期待される API 契約 (最小要件):

- リクエスト: `GET /info`（クエリパラメータで検索語を受け取る実装も可能、例: `/info?text=mountain`）
- レスポンス: JSON オブジェクトで `url` フィールドを返す。
	- 例: `{ "url": "http://pigallery-host/pgapi/gallery/random/%7B%22type%22%3A100%2C%22text%22%3A%22mountain%22%7D/info" }`

動作イメージ:
- `app.js` が `convertinfoapiurl` にアクセス → プロキシが PiGallery2 のランダム API（`/pgapi/gallery/random/<encoded_query>/info`）を参照する URL を組み立てて返す → `app.js` が返却された `url` を fetch して Info JSON を取得 → メディア URL を組み立てて表示

簡易 Node.js (Express) の例（参考）:

```js
// Node で簡易プロキシを作るサンプル（実運用ではエラーハンドリングやセキュリティを追加してください）
const express = require('express');
const app = express();
const PIGALLEY_HOST = process.env.PIGALLEY_HOST || 'http://pigallery-host';

app.get('/info', (req, res) => {
	const text = req.query.text || '';
	const q = encodeURIComponent(JSON.stringify({ type: 100, text }));
	const infoUrl = `${PIGALLEY_HOST}/pgapi/gallery/random/${q}/info`;
	// 必要ならここで PiGallery2 に問い合わせて結果を加工してから返してもよい
	res.json({ url: infoUrl });
});

app.listen(8000, () => console.log('Info-proxy listening on :8000'));
```

注意点:
- CORS: Wallpaper Engine の Web ビューから直接プロキシにアクセスするため、プロキシは適切な CORS ヘッダを返してください。
- 認証: PiGallery2 が認証を要求する場合はプロキシ側で認証/トークン注入を行うか、クライアントに合わせて実装してください。
- 高度な選定: プロキシ内でタグのランダム選択、重み付け、キャッシュ、有効性チェック（非画像/壊れファイル除外）などを実装できます。

設定例（`app.js` 側）:
- `app.js` の先頭で `convertinfoapiurl` をプロキシのエンドポイントに合わせて更新してください。
	- 例: `const convertinfoapiurl = 'http://localhost:8000/info/';`

