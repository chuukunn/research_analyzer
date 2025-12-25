# Research Analyzer

OpenAlexおよびSemantic Scholarから論文データを取得し、共著ネットワーク、引用ネットワーク、トピック分析（UMAP + HDBSCAN）を可視化するツールです。

## 機能
- **データ取得**: 指定した著者IDまたは論文IDに関連する論文を取得
- **共著者ネットワーク**: 共著関係をグラフ化し、コミュニティ検出を実行
- **引用ネットワーク**: 論文間の引用関係を可視化
- **トピック分析**: アブストラクトのベクトル化（SentenceBERT）、次元削減（UMAP）、クラスタリング（HDBSCAN）によるトピック抽出
- **時系列分析**: 研究グループや論文誌の活動期間を表示

## 必要要件
- Python 3.8+
- 推奨: CUDA対応GPU（SentenceBERT, UMAPの高速化のため）

## インストール

1. リポジトリをクローンします。
   ```bash
   git clone https://github.com/chuukunn/reseatch_analyzer.git
   cd reseatch_analyzer
   ```

2. 依存パッケージをインストールします。
   ```bash
   pip install -r requirements.txt
   ```

## 設定

OpenAlex APIを使用する際、Polite Poolを利用するためにメールアドレスの設定が推奨されます。環境変数 `OPENALEX_EMAIL` を設定してください。

**Windows (PowerShell):**
```powershell
$env:OPENALEX_EMAIL = "your_email@example.com"
```

**Linux/Mac:**
```bash
export OPENALEX_EMAIL="your_email@example.com"
```

※ 設定しない場合、デフォルト値が使用されますが、パフォーマンスや制限に影響する可能性があります。

## 実行方法

1. アプリケーションを起動します。
   ```bash
   python main.py
   ```

2. ブラウザで以下のURLにアクセスします。
   ```
   http://127.0.0.1:5000
   ```

## ライセンス
MIT License
