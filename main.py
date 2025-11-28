# main.py ---------------------------------------------------------------
import json
import hashlib
from flask import Flask, jsonify, render_template, request
from sentence_transformers import SentenceTransformer
import nltk
from nltk.corpus import stopwords

# Custom modules for data fetching and analysis
from data_fetcher import fetch_papers_from_openalex
from analyzer import analyze_papers

# ---------------- 初期化 (Initialization) ----------------
nltk.download("stopwords", quiet=True)
STOP_WORDS = list(stopwords.words("english"))

print("Loading SentenceTransformer model...")
# テキスト埋め込みはSimCSEで固定
embedding_models = {
    "simcse": SentenceTransformer('princeton-nlp/sup-simcse-bert-base-uncased'),
}
print("SentenceTransformer model loaded.")

app = Flask(__name__, static_folder="static", template_folder="templates")

# --- グローバル変数 (Global Variables) ---
paper_cache = {}
analysis_cache = {}
precomputed_cache = {} # Cache for embeddings and other heavy data
vector_cache = {} # ★ 論文IDごとのベクトルを永続的にキャッシュ

# ------------ Flaskエンドポイント (Flask Endpoints) ------------
@app.route("/data")
def data():
    force_refetch = request.args.get('force_refetch', 'false').lower() == 'true'
    recluster_only = request.args.get('recluster_only', 'false').lower() == 'true'
    
    # --- パラメータの取得 (Get Parameters) ---
    base_params = {
        "aid": request.args.get("aid", "a5086198262"),
        "max_papers": request.args.get("max_papers", type=int, default=200),
    }
    
    # クラスタリングモデルの取得
    clustering_model = request.args.get("clustering_model", "hdbscan")
    
    # ★ 修正: kの値の取得ロジックを簡素化
    # フロントエンドがモデルに関わらず 'k' パラメータで正しい値を送ってくることを前提とする
    k_value = request.args.get("k", type=int, default=8)

    analysis_params = {
        "k": k_value,
        "time_weight": request.args.get("time_weight", default=0, type=float),
        "n_neighbors": request.args.get("n_neighbors", default=15, type=int),
        "min_dist": request.args.get("min_dist", default=0.1, type=float),
        "embedding_model": "simcse", # SimCSEに固定
        "dim_red_model": "umap", # UMAPに固定
        "clustering_model": clustering_model,
    }
    
    # --- キャッシュキーの定義 ---
    
    # 1. 論文取得キャッシュキー (AID, max_papers)
    base_key = hashlib.md5(json.dumps(base_params, sort_keys=True).encode()).hexdigest()
    
    # 2. ベクトル化キャッシュキー (論文 + embedding_model, time_weight)
    embedding_key_params = {
        "embedding_model": analysis_params["embedding_model"],
        "time_weight": analysis_params["time_weight"],
    }
    embedding_key_suffix = hashlib.md5(json.dumps(embedding_key_params, sort_keys=True).encode()).hexdigest()
    embedding_key = f"{base_key}_{embedding_key_suffix}"

    # 3. 次元削減キャッシュキー (ベクトル化 + dim_red_model, n_neighbors, min_dist)
    full_precompute_key_params = {
        **embedding_key_params,
        "dim_red_model": analysis_params["dim_red_model"],
        "n_neighbors": analysis_params["n_neighbors"],
        "min_dist": analysis_params["min_dist"]
    }
    full_precompute_key_suffix = hashlib.md5(json.dumps(full_precompute_key_params, sort_keys=True).encode()).hexdigest()
    full_precompute_key = f"{base_key}_{full_precompute_key_suffix}"
    
    # 4. 最終分析キャッシュキー (すべて + k, clustering_model)
    # 修正点: base_params を除き、analysis_params のみでハッシュを生成
    full_key_params = {
        **analysis_params
    }
    full_key_suffix = hashlib.md5(json.dumps(full_key_params, sort_keys=True).encode()).hexdigest()
    full_key = f"{base_key}_{full_key_suffix}"


    # --- キャッシュの確認 (1. 最終分析) ---
    if not force_refetch and full_key in analysis_cache:
        print(f"Returning full analysis from cache (key: {full_key})")
        return jsonify(analysis_cache[full_key])

    # --- force_refetch の処理 ---
    if force_refetch:
        print("Force refetch requested. Clearing paper and precomputed caches.")
        paper_cache.pop(base_key, None)
        
        # 修正点: base_key で始まるすべてのキャッシュを削除
        precomputed_keys_to_del = [k for k in precomputed_cache if k.startswith(base_key)]
        for k in precomputed_keys_to_del:
            precomputed_cache.pop(k, None)
            
        analysis_keys_to_del = [k for k in analysis_cache if k.startswith(base_key)]
        for k in analysis_keys_to_del:
            analysis_cache.pop(k, None)
            
        # ★ vector_cache はクリアしない
        print(f"Removed {len(precomputed_keys_to_del)} precomputed cache entries and {len(analysis_keys_to_del)} analysis cache entries related to base_key {base_key}")
        print(f"Persistent vector_cache size: {len(vector_cache)}")


    # --- 論文データの取得 (キャッシュ 2. 論文) ---
    papers_tuple = paper_cache.get(base_key)
    if not papers_tuple:
        print(f"Fetching papers from OpenAlex (aid: {base_params['aid']})")
        papers, main_author_name, error = fetch_papers_from_openalex(base_params['aid'], base_params['max_papers'])
        if error:
            return jsonify({"error": str(error)}), 500
        paper_cache[base_key] = (papers, main_author_name)
    else:
        print(f"Using cached papers (key: {base_key})")
        papers, main_author_name = papers_tuple

    # SimCSEモデルを直接取得
    embedding_model = embedding_models["simcse"]

    # --- 修正点: precomputed_data の準備ロジック ---
    precomputed_data_to_pass = None
    
    # recluster_only に関係なく、まずキャッシュを探す
    
    # 1. 次元削減まで完了したキャッシュを探す (フルキャッシュ)
    cached_full_precomputed = precomputed_cache.get(full_precompute_key)
    if cached_full_precomputed:
        print(f"Using cached precomputed data (full key: {full_precompute_key})")
        precomputed_data_to_pass = cached_full_precomputed
    else:
        # 2. ベクトル化だけ完了したキャッシュを探す
        cached_embedding_precomputed = precomputed_cache.get(embedding_key)
        if cached_embedding_precomputed:
            print(f"Using cached embedding data (embedding key: {embedding_key})")
            # 'reduced_10d' などが存在しないため、analyzer.py は次元削減から実行する
            precomputed_data_to_pass = cached_embedding_precomputed
        else:
            # キャッシュが何もない場合
            if recluster_only:
                print(f"Recluster requested, but no precomputed data found (key: {full_precompute_key} or {embedding_key})")
            else:
                print(f"No precomputed data found. Starting from scratch (key: {full_precompute_key} or {embedding_key})")
    # --- 修正ここまで ---
    
    # --- 分析の実行 ---
    analysis_result = analyze_papers(
        papers=dict(papers), 
        params=analysis_params,
        embedding_model=embedding_model,
        stop_words=STOP_WORDS,
        precomputed_data=precomputed_data_to_pass, # Noneか、キャッシュされたデータ
        main_author_name=main_author_name,
        vector_cache=vector_cache # ★ 論文ごとベクトルキャッシュを渡す
    )
    
    # --- 分析結果のキャッシュ保存 ---
    if 'precomputed_data' in analysis_result:
        updated_precomputed_data = analysis_result['precomputed_data']
        
        # 1. 'reduced_10d' があれば、次元削減キャッシュ（フル）を更新
        if 'reduced_10d' in updated_precomputed_data:
            # 常に最新のデータで上書きする
            precomputed_cache[full_precompute_key] = updated_precomputed_data
            print(f"Stored/Updated full precomputed data in cache (key: {full_precompute_key})")
        
        # 2. 'reduced_10d' はないが 'combined_embeddings' がある場合、ベクトル化キャッシュを更新
        elif 'combined_embeddings' in updated_precomputed_data:
            # ベクトル化キャッシュにはベクトル化関連のデータのみ保存
            embedding_cache_data = {
                'docs': updated_precomputed_data.get('docs'),
                'pids_with_abs': updated_precomputed_data.get('pids_with_abs'),
                'combined_embeddings': updated_precomputed_data.get('combined_embeddings')
            }
            # 常に最新のデータで上書きする
            precomputed_cache[embedding_key] = embedding_cache_data
            print(f"Stored/Updated embedding data in cache (key: {embedding_key})")

    # --- 最終データの整形 ---
    analyzed_papers = analysis_result['papers']
    paper_map = {pid: p for pid, p in analyzed_papers.items()}
    edges = [{"source": r, "target": pid} for pid, p in paper_map.items() for r in p.get("references", []) if r in paper_map]

    final_data = {
        "nodes": list(analyzed_papers.values()),
        "edges": edges,
        "topic_info": analysis_result['topic_info'].to_dict(orient='records') if not analysis_result['topic_info'].empty else [],
        "dendrogram_data": analysis_result.get('dendrogram_data'),
        "co_author_data": analysis_result.get('co_author_data', {}),
        "institution_data": analysis_result.get('institution_data', {}),
        "timeline_data": analysis_result.get('timeline_data', []),
        "main_author_name": main_author_name
    }
    
    # 最終分析結果をキャッシュ
    analysis_cache[full_key] = final_data
    print(f"Stored full analysis in cache (key: {full_key})")
    return jsonify(final_data)

@app.route("/")
def index():
    return render_template("index.html")

if __name__ == "__main__":
    app.run(debug=True, use_reloader=False)