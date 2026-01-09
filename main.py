# main.py ---------------------------------------------------------------
import json
import hashlib
from flask import Flask, jsonify, render_template, request
from sentence_transformers import SentenceTransformer
import nltk
from nltk.corpus import stopwords

# Custom modules for data fetching and analysis
# Custom modules for data fetching and analysis
from data_fetcher import fetch_papers
from analyzer import analyze_papers
import os
from dotenv import load_dotenv
import google.generativeai as genai

# ---------------- 初期化 (Initialization) ----------------
nltk.download("stopwords", quiet=True)
STOP_WORDS = list(stopwords.words("english"))

print("Loading SentenceTransformer model...")
# テキスト埋め込みはSimCSEで固定
embedding_models = {
    "simcse": SentenceTransformer('princeton-nlp/sup-simcse-bert-base-uncased'),
}
print("SentenceTransformer model loaded.")

# --- Gemini API Setup ---
load_dotenv()
GOOGLE_API_KEY = os.getenv('GEMINI_API_KEY')
if GOOGLE_API_KEY:
    genai.configure(api_key=GOOGLE_API_KEY)
# Default model, can be overridden by env var
GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")

app = Flask(__name__, static_folder="static", template_folder="templates")

# --- Cache Manager Class ---
class CacheManager:
    def __init__(self):
        self.paper_cache = {}
        self.analysis_cache = {}
        self.precomputed_cache = {}
        self.vector_cache = {} # Persistent vector cache

    def get_base_key(self, params):
        # Adding a version suffix to invalidate previous caches due to logic change
        version = "v2" 
        return hashlib.md5((json.dumps(params, sort_keys=True) + version).encode()).hexdigest()

    def get_embedding_key(self, base_key, params):
        key_params = {
            "embedding_model": params["embedding_model"],
            "time_weight": params["time_weight"],
        }
        suffix = hashlib.md5(json.dumps(key_params, sort_keys=True).encode()).hexdigest()
        return f"{base_key}_{suffix}"

    def get_full_precompute_key(self, base_key, params):
        key_params = {
            "embedding_model": params["embedding_model"],
            "time_weight": params["time_weight"],
            "dim_red_model": params["dim_red_model"],
            "n_neighbors": params["n_neighbors"],
            "min_dist": params["min_dist"]
        }
        suffix = hashlib.md5(json.dumps(key_params, sort_keys=True).encode()).hexdigest()
        return f"{base_key}_{suffix}"

    def get_analysis_key(self, base_key, params):
        suffix = hashlib.md5(json.dumps(params, sort_keys=True).encode()).hexdigest()
        return f"{base_key}_{suffix}"

    def clear_related_cache(self, base_key):
        print(f"Clearing cache related to base_key: {base_key}")
        self.paper_cache.pop(base_key, None)
        
        precomputed_keys_to_del = [k for k in self.precomputed_cache if k.startswith(base_key)]
        for k in precomputed_keys_to_del:
            self.precomputed_cache.pop(k, None)
            
        analysis_keys_to_del = [k for k in self.analysis_cache if k.startswith(base_key)]
        for k in analysis_keys_to_del:
            self.analysis_cache.pop(k, None)
        
        print(f"Removed {len(precomputed_keys_to_del)} precomputed entries and {len(analysis_keys_to_del)} analysis entries.")

    def get_cached_analysis(self, key):
        return self.analysis_cache.get(key)

    def set_cached_analysis(self, key, data):
        self.analysis_cache[key] = data

    def get_cached_papers(self, key):
        return self.paper_cache.get(key)

    def set_cached_papers(self, key, data):
        self.paper_cache[key] = data

    def get_precomputed_data(self, full_key, embedding_key):
        # 1. Try full precomputed data (UMAP done)
        if full_key in self.precomputed_cache:
            print(f"Using cached precomputed data (full key: {full_key})")
            return self.precomputed_cache[full_key]
        
        # 2. Try embedding only data
        if embedding_key in self.precomputed_cache:
            print(f"Using cached embedding data (embedding key: {embedding_key})")
            return self.precomputed_cache[embedding_key]
            
        return None

    def update_precomputed_cache(self, full_key, embedding_key, data):
        if 'reduced_10d' in data:
            self.precomputed_cache[full_key] = data
            print(f"Stored/Updated full precomputed data (key: {full_key})")
        elif 'combined_embeddings' in data:
            embedding_cache_data = {
                'docs': data.get('docs'),
                'pids_with_abs': data.get('pids_with_abs'),
                'combined_embeddings': data.get('combined_embeddings')
            }
            self.precomputed_cache[embedding_key] = embedding_cache_data
            print(f"Stored/Updated embedding data (key: {embedding_key})")

# Initialize Cache Manager
cache_manager = CacheManager()

# ------------ Flaskエンドポイント (Flask Endpoints) ------------
@app.route("/data")
def data():
    force_refetch = request.args.get('force_refetch', 'false').lower() == 'true'
    recluster_only = request.args.get('recluster_only', 'false').lower() == 'true'
    
    # --- パラメータの取得 (Get Parameters) ---
    base_params = {
        "aid": request.args.get("aid", "a5086198262"),
        "max_papers": request.args.get("max_papers", type=int, default=1000),
        "source": request.args.get("source", "openalex")
    }
    
    clustering_model = request.args.get("clustering_model", "hdbscan")
    k_value = request.args.get("k", type=int, default=8)
    
    # フィルタリングパラメータ
    min_abs_len = request.args.get("min_abs_len", default=0, type=int)
    excluded_ids_str = request.args.get("excluded_ids", default="")
    excluded_ids = set(excluded_ids_str.split(",")) if excluded_ids_str else set()

    analysis_params = {
        "k": k_value,
        "time_weight": request.args.get("time_weight", default=0, type=float),
        "n_neighbors": request.args.get("n_neighbors", default=15, type=int),
        "min_dist": request.args.get("min_dist", default=0.1, type=float),
        "embedding_model": "simcse",
        "dim_red_model": "umap",
        "clustering_model": clustering_model,
        "min_abs_len": min_abs_len,
        "excluded_ids_hash": hashlib.md5(excluded_ids_str.encode()).hexdigest() # Cache key component
    }
    
    # --- Fetch Papers First (Content-Based Key Generation) ---
    # We fetch papers first because the "cache key" for analysis should depend on the ACTUAL data returned.
    # (e.g., if we request 500 but get 5000 from a "better" cache, we want the key to reflect the 5000 papers)
    
    # Check if we should clear caches based on force_refetch BEFORE fetching?
    # Actually, force_refetch now primarily guides fetch_papers.
    # After fetching, if we get new data, we get a new Key, so old caches are naturally bypassed.
    
    print(f"Fetching papers from {base_params['source']} (aid: {base_params['aid']})")
    papers, main_author_name, error = fetch_papers(base_params['source'], base_params['aid'], base_params['max_papers'], force_refetch=force_refetch)
    
    if error:
        return jsonify({"error": str(error)}), 500

    # Generate Base Key from Content (Paper IDs)
    # This ensures that analysis is cached against the exact set of papers being analyzed.
    sorted_pids = sorted(papers.keys())
    # Include main_author_name in key just in case it varies (unlikely for same IDs but safe)
    content_str = json.dumps(sorted_pids) + str(main_author_name)
    base_key = hashlib.md5(content_str.encode()).hexdigest()
    
    # --- Cache Keys ---
    # base_key is now content-derived.
    embedding_key = cache_manager.get_embedding_key(base_key, analysis_params)
    full_precompute_key = cache_manager.get_full_precompute_key(base_key, analysis_params)
    full_analysis_key = cache_manager.get_analysis_key(base_key, analysis_params)

    # --- Check Full Analysis Cache ---
    # If explicit force_refetch was requested, we might want to skip this?
    # User said: "Even if I re-acquire... if cache exists use it." -> This suggests we use cache if available.
    # Since fetch_papers already handles "smart" data retrieval, we can trust the Analysis Cache for this data.
    
    if not force_refetch:
        cached_result = cache_manager.get_cached_analysis(full_analysis_key)
        if cached_result:
            print(f"Returning full analysis from cache (key: {full_analysis_key})")
            return jsonify(cached_result)
            
    # If force_refetch is True, but fetch_papers returned cached data (because it was 'better'),
    # we theoretically could still use the Analysis Cache.
    # But traditionally force_refetch implies "Redo Analysis" too.
    # However, given the user's strong "Use Cache" instruction, maybe we should check cache even if force_refetch=True?
    # Let's stick to: If force_refetch=True passed to URL, we skip Analysis Cache check here (re-analyze).
    # BUT fetch_papers might have returned old data. If we re-analyze old data, we just get same result (deterministic).
    # So it doesn't hurt to re-run analysis if user explicitly forced it. 
    # But for "smart cache" use case (request 500, get 5000), force_refetch is likely False.
    
    # Re-check cache even if force_refetch was passed? 
    # Logic: 
    # 1. User clicks "Analyze" -> force_refetch usually false? 
    # 2. User clicks "Re-acquire" -> force_refetch=True? 
    #    -> fetch_papers might return cached data anyway.
    #    -> key is same.
    #    -> If valid analysis exists for this data, why re-compute?
    #    -> I'll enable cache check unconditionally for now, or maybe only if not recluster_only.
    #    -> Let's leave the `if not force_refetch` block as is. If user forces, we re-compute. That's safer.

    # --- Prepare Precomputed Data ---
    precomputed_data_to_pass = cache_manager.get_precomputed_data(full_precompute_key, embedding_key)
    
    if not precomputed_data_to_pass:
        if recluster_only:
             print("Recluster requested but no precomputed data found.")
        else:
             print("No precomputed data found. Starting from scratch.")

    # --- Run Analysis ---
    embedding_model = embedding_models["simcse"]
    
    # Filter papers before analysis
    papers_to_analyze = {pid: p for pid, p in papers.items() if pid not in excluded_ids}
    
    analysis_result = analyze_papers(
        papers=papers_to_analyze, 
        params=analysis_params,
        embedding_model=embedding_model,
        stop_words=STOP_WORDS,
        precomputed_data=precomputed_data_to_pass,
        main_author_name=main_author_name,
        vector_cache=cache_manager.vector_cache
    )
    
    # --- Update Caches ---
    if 'precomputed_data' in analysis_result:
        cache_manager.update_precomputed_cache(full_precompute_key, embedding_key, analysis_result['precomputed_data'])

    # --- Format Final Data ---
    analyzed_papers = analysis_result['papers']
    paper_map = {pid: p for pid, p in analyzed_papers.items()}
    edges = [{"source": pid, "target": r} for pid, p in paper_map.items() for r in p.get("references", []) if r in paper_map]

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
    
    cache_manager.set_cached_analysis(full_analysis_key, final_data)
    print(f"Stored full analysis in cache (key: {full_analysis_key})")
    
    cache_manager.set_cached_analysis(full_analysis_key, final_data)
    print(f"Stored full analysis in cache (key: {full_analysis_key})")
    
    return jsonify(final_data)

@app.route("/api/generate", methods=["POST"])
def generate_content():
    if not GOOGLE_API_KEY:
        return jsonify({"error": "GEMINI_API_KEY is not set in the server environment."}), 500

    data = request.get_json()
    if not data or "prompt" not in data:
        return jsonify({"error": "No prompt provided"}), 400

    prompt = data["prompt"]

    try:
        model = genai.GenerativeModel(GEMINI_MODEL_NAME)
        response = model.generate_content(prompt)
        
        # テキストがブロックされている場合などのハンドリング
        if response.text:
            return jsonify({"text": response.text})
        else:
             return jsonify({"error": "No text returned from API (safety filter?)"}), 500

    except Exception as e:
        print(f"Gemini API Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/")
def index():
    return render_template("index.html")

if __name__ == "__main__":
    app.run(debug=True, use_reloader=False)