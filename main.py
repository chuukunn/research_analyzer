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
embedding_models = {
    "sentencetransformer": SentenceTransformer('all-MiniLM-L6-v2'),
    "simcse": SentenceTransformer('princeton-nlp/sup-simcse-bert-base-uncased'),
    "bert": SentenceTransformer('bert-base-uncased'),
}
print("SentenceTransformer model loaded.")

app = Flask(__name__, static_folder="static", template_folder="templates")

# --- グローバル変数 (Global Variables) ---
paper_cache = {}
analysis_cache = {}
precomputed_cache = {} # Cache for embeddings and other heavy data

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
    analysis_params = {
        "k": request.args.get("k", type=int, default=8),
        "time_weight": request.args.get("time_weight", default=0, type=float),
        "n_neighbors": request.args.get("n_neighbors", default=15, type=int),
        "min_dist": request.args.get("min_dist", default=0.1, type=float),
        "embedding_model": request.args.get("embedding_model", "sentencetransformer"),
        "dim_red_model": request.args.get("dim_red_model", "umap"),
        "clustering_model": request.args.get("clustering_model", "hdbscan"),
    }
    
    base_key = hashlib.md5(json.dumps(base_params, sort_keys=True).encode()).hexdigest()
    # embedding_modelの選択もキャッシュキーに含める
    precompute_key_params = {**base_params, "embedding_model": analysis_params["embedding_model"]}
    precompute_key = hashlib.md5(json.dumps(precompute_key_params, sort_keys=True).encode()).hexdigest()
    
    full_key = hashlib.md5(json.dumps({**base_params, **analysis_params}, sort_keys=True).encode()).hexdigest()

    if not force_refetch and full_key in analysis_cache:
        return jsonify(analysis_cache[full_key])

    if force_refetch:
        paper_cache.pop(base_key, None)
        # embedding modelが変わる可能性があるので、関連するprecomputed_cacheもクリア
        keys_to_del = [k for k in precomputed_cache if k.startswith(base_key)]
        for k in keys_to_del:
            precomputed_cache.pop(k, None)


    papers_tuple = paper_cache.get(base_key)
    if not papers_tuple:
        papers, main_author_name, error = fetch_papers_from_openalex(base_params['aid'], base_params['max_papers'])
        if error:
            return jsonify({"error": str(error)}), 500
        paper_cache[base_key] = (papers, main_author_name)
    else:
        papers, main_author_name = papers_tuple

    # 選択された埋め込みモデルを取得（シミュレーション）
    selected_embedding_model_name = analysis_params["embedding_model"]
    embedding_model = embedding_models.get(selected_embedding_model_name.lower())
    if not embedding_model:
        # 見つからない場合はデフォルトを使用
        embedding_model = embedding_models["sentencetransformer"]
        print(f"Warning: embedding model '{selected_embedding_model_name}' not found. Falling back to default.")


    precomputed = precomputed_cache.get(precompute_key) if recluster_only else None
    
    analysis_result = analyze_papers(
        papers=dict(papers), 
        params=analysis_params,
        embedding_model=embedding_model,
        stop_words=STOP_WORDS,
        precomputed_data=precomputed,
        main_author_name=main_author_name
    )
    
    if 'precomputed_data' in analysis_result:
        precomputed_cache[precompute_key] = analysis_result['precomputed_data']

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
    
    analysis_cache[full_key] = final_data
    return jsonify(final_data)

@app.route("/")
def index():
    return render_template("index.html")

if __name__ == "__main__":
    app.run(debug=True, use_reloader=False)
