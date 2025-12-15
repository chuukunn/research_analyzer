import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import MinMaxScaler
from sklearn.cluster import KMeans
import umap
import hdbscan
from scipy.cluster.hierarchy import to_tree
from hdbscan.flat import HDBSCAN_flat
import itertools
import networkx as nx
from networkx.algorithms import community
from collections import defaultdict

def analyze_co_authorship(papers, main_author_name):
    """共著者ネットワークを分析し、クラスタリングする"""
    if not papers:
        return {"nodes": [], "edges": []}

    author_collaborations = {}
    edges = {}

    for paper_id, p in papers.items():
        authors = [au['name'] for au in p.get('authorships', []) if au.get('name') and au['name'] != main_author_name]
        if not authors:
            continue

        for author in authors:
            if author not in author_collaborations:
                author_collaborations[author] = {'years': [], 'paper_ids': []}
            author_collaborations[author]['years'].append(p['year'])
            author_collaborations[author]['paper_ids'].append(paper_id)

        for author1, author2 in itertools.combinations(authors, 2):
            edge = tuple(sorted((author1, author2)))
            if edge not in edges:
                edges[edge] = 0
            edges[edge] += 1

    # NetworkXグラフを作成
    G = nx.Graph()
    for (u, v), w in edges.items():
        G.add_edge(u, v, weight=w)

    # コミュニティ検出 (Louvain) - networkxの推奨関数に変更
    partition = {}
    if G.nodes:
        # louvain_communitiesはコミュニティのセットのリストを返す
        # {node: community_id} の辞書形式に変換する
        communities_sets = community.louvain_communities(G, weight='weight', seed=42)
        for i, community_set in enumerate(communities_sets):
            for node in community_set:
                partition[node] = i

    # ノードリストを作成
    nodes = []
    for author, data in author_collaborations.items():
        years = [y for y in data['years'] if y is not None]
        if not years: continue
        nodes.append({
            "id": author,
            "cluster": partition.get(author, -1),
            "paper_count": len(data['paper_ids']),
            "start_year": min(years),
            "end_year": max(years)
        })

    # エッジリストを作成
    links = [{"source": u, "target": v, "weight": w} for (u, v), w in edges.items()]

    return {"nodes": nodes, "links": links}

def analyze_timeline_entities(papers, co_author_data):
    """研究グループ、論文誌の活動期間を分析する"""
    timeline_data = []

    # 1. 研究グループ (Research Groups)
    if co_author_data and "nodes" in co_author_data:
        group_years = defaultdict(list)
        for author in co_author_data["nodes"]:
            cluster_id = author.get("cluster")
            if cluster_id is not None and cluster_id != -1:
                group_years[cluster_id].extend([author["start_year"], author["end_year"]])
        
        for cluster_id, years in group_years.items():
            if years:
                timeline_data.append({
                    "name": f"Group {cluster_id}",
                    "start_year": min(years),
                    "end_year": max(years),
                    "category": "Research Group"
                })

    # 3. 論文誌 (Journals)
    journal_years = defaultdict(list)
    for _, p in papers.items():
        year = p.get("year")
        if not year or year == 0:
            continue
        if venue := p.get("venue_name"):
            journal_years[venue].append(year)

    for journal, years in journal_years.items():
        if years:
            timeline_data.append({
                "name": journal,
                "start_year": min(years),
                "end_year": max(years),
                "category": "Journal"
            })
    
    # Sort each category by start year and then combine
    groups = sorted([d for d in timeline_data if d['category'] == 'Research Group'], key=lambda x: x['start_year'])
    journals = sorted([d for d in timeline_data if d['category'] == 'Journal'], key=lambda x: x['start_year'])
    
    return groups + journals

def _get_embeddings(papers, params, embedding_model, vector_cache):
    """
    論文のベクトル化を行う。キャッシュを利用する。
    """
    print("[analyzer] Step 4/6: Embedding (Vectorization)...")
    
    docs, pids_with_abs, years = [], [], []
    MIN_ABSTRACT_WORDS = params.get('min_abs_len', 50) # Use param or default to 50
    print(f"[analyzer] Filtering with Min Abstract Length: {MIN_ABSTRACT_WORDS} characters")

    for pid, p in papers.items():
        abs_text = (p.get("abstract") or "").strip()
        
        # ユーザー要望: アブストラクトが存在しないものは除外する
        # また、タイトルへのフォールバックは行うが、長さチェックを入れる
        if abs_text and len(abs_text) >= MIN_ABSTRACT_WORDS:
            docs.append(abs_text)
            pids_with_abs.append(pid)
            years.append(p.get("year", 0))
        else:
            # アブストラクトがない場合、タイトルとキーワードで代用する
            title = (p.get("title") or "").strip()
            # タイトルのみの場合も、ある程度の長さは必要か？とりあえずそのまま通すが、
            # min_abs_len が高い場合はタイトルだけでは弾かれるべきかもしれない。
            # 要望は「アブストラクトが特定の文字数以下」なので、タイトルフォールバック時は
            # 本来のアブストラクト長チェックは適用外とするか、厳密に適用するか。
            # ここでは「アブストラクトがあれば長さチェック、なければタイトル」というロジックにする。
            
            # もし「タイトルも短すぎるものは除外」ならここも調整。
            if title:
                # タイトルとキーワードを組み合わせることで、情報量を増やす
                keywords = ", ".join(p.get("keywords", []) or [])
                fallback_text = f"{title}. {keywords}" if keywords else title
                docs.append(fallback_text)
                
                pids_with_abs.append(pid)
                years.append(p.get("year", 0))
            else:
                 p.update({"topic": -1, "topic_keywords": "N/A", "embedding_2d": []})
    
    print(f"[analyzer] Processing {len(docs)} documents out of {len(papers)} total.")
    
    if not docs or len(docs) < params.get('n_neighbors', 15):
        print("[analyzer] Not enough documents for analysis. Skipping.")
        return None, None, None

    content_vectors_map = {}
    docs_to_encode_indices = []
    docs_to_encode_texts = []

    for i, pid in enumerate(pids_with_abs):
        if pid in vector_cache:
            content_vectors_map[pid] = vector_cache[pid]
        else:
            docs_to_encode_indices.append(i)
            docs_to_encode_texts.append(docs[i])
    
    print(f"[analyzer] Found {len(content_vectors_map)} vectors in vector_cache.")
    
    if docs_to_encode_texts:
        print(f"[analyzer] Running SentenceTransformer.encode() for {len(docs_to_encode_texts)} new documents...")
        new_vectors = embedding_model.encode(docs_to_encode_texts, show_progress_bar=True)
        
        for i, new_vector in enumerate(new_vectors):
            original_index = docs_to_encode_indices[i]
            pid = pids_with_abs[original_index]
            vector_cache[pid] = new_vector
            content_vectors_map[pid] = new_vector
        print(f"[analyzer] Encoding complete. Updated vector_cache size: {len(vector_cache)}")
    
    content_embeddings_list = [content_vectors_map[pid] for pid in pids_with_abs]
    content_embeddings = np.array(content_embeddings_list)
    
    if params.get('time_weight', 0) > 0:
        print(f"[analyzer] Applying time_weight: {params['time_weight']}")
        year_scaler = MinMaxScaler()
        time_vector = year_scaler.fit_transform(np.array(years).reshape(-1, 1))
        weighted_time_vector = time_vector * params['time_weight']
        combined_embeddings = np.hstack([content_embeddings, weighted_time_vector])
    else:
        combined_embeddings = content_embeddings
        
    return combined_embeddings, docs, pids_with_abs

def _reduce_dimensions(combined_embeddings, params):
    """
    UMAPによる次元削減を行う。
    """
    print(f"[analyzer] Step 5/6: Reducing dimensions with UMAP (n_neighbors={params['n_neighbors']}, min_dist={params['min_dist']})...")
    
    # クラスタリング用の高次元埋め込み(10D)
    umap_cluster_model = umap.UMAP(n_neighbors=15, n_components=10, min_dist=0.1, random_state=42)
    reduced_10d = umap_cluster_model.fit_transform(combined_embeddings)
        
    # 可視化用の2D埋め込み
    umap_viz_model = umap.UMAP(n_neighbors=params['n_neighbors'], n_components=2, min_dist=params['min_dist'], random_state=42)
    reduced_2d = umap_viz_model.fit_transform(combined_embeddings)
    
    return reduced_10d, reduced_2d

def _cluster_papers(reduced_10d, params, docs):
    """
    クラスタリングを行う。
    """
    print(f"[analyzer] Step 6/6: Clustering with {params['clustering_model']} (k={params['k']})...")
    clusterer_model = params['clustering_model'].lower()
    dendrogram_tree = None
    topics = []

    if clusterer_model == 'hdbscan':
        min_cluster_size = int(params['k'])
        print(f"[analyzer] Running HDBSCAN with min_cluster_size={min_cluster_size}")

        hdbscan_clusterer = hdbscan.HDBSCAN(
            min_cluster_size=min_cluster_size, 
            min_samples=1, # ノイズを減らすために最小サンプル数を1に設定
            gen_min_span_tree=True
        )
        topics = hdbscan_clusterer.fit_predict(reduced_10d)
        
        try:
            linkage_matrix = hdbscan_clusterer.single_linkage_tree_.to_numpy()
            def build_tree(node, linkage, n_samples):
                if node.is_leaf(): return {"name": f"doc_{node.id}", "size": 1}
                distance = linkage[node.id - n_samples][2] if (node.id - n_samples) < len(linkage) else 0
                return {"name": f"node_{node.id}", "distance": distance, "children": [build_tree(node.get_left(), linkage, n_samples), build_tree(node.get_right(), linkage, n_samples)]}
            n_samples = len(docs)
            root_node = to_tree(linkage_matrix, rd=True)
            dendrogram_tree = build_tree(root_node[0], linkage_matrix, n_samples) if root_node else None
        except Exception as e:
            print(f"[analyzer] Warning: Failed to generate dendrogram: {e}")
            dendrogram_tree = None

    elif clusterer_model == 'kmeans':
        kmeans_clusterer = KMeans(n_clusters=params['k'], random_state=42, n_init=10)
        topics = kmeans_clusterer.fit_predict(reduced_10d)
        dendrogram_tree = None
    else: 
        hdbscan_clusterer = hdbscan.HDBSCAN(min_cluster_size=params['k'], min_samples=1, gen_min_span_tree=False)
        topics = hdbscan_clusterer.fit_predict(reduced_10d)
        # トピックが-1（未分類）の論文を新しいトピック番号に割り当てる処理を削除
        # HDBSCANのノイズ(-1)はそのままノイズとして扱うべきであり、
        # 無理やり一つのクラスタにまとめると分析結果が歪むため。
        # フロントエンドは topic: -1 をグレーで表示するように実装されている。
    
    return topics, dendrogram_tree

def _extract_keywords(docs, topics, stop_words):
    """
    キーワード抽出を行う。
    """
    print("[analyzer] Generating topic keywords and top overall keywords...")
    documents = pd.DataFrame({"doc": docs, "topic": topics})
    
    top_overall_keywords = []
    try:
        overall_vectorizer = TfidfVectorizer(stop_words=stop_words, ngram_range=(1, 2), max_features=50)
        overall_tfidf = overall_vectorizer.fit_transform(documents['doc'])
        overall_words = overall_vectorizer.get_feature_names_out()
        mean_tfidf = overall_tfidf.mean(axis=0).A1
        top_overall_keywords_indices = mean_tfidf.argsort()[-30:][::-1]
        top_overall_keywords = [{"word": overall_words[i], "score": mean_tfidf[i]} for i in top_overall_keywords_indices]
    except ValueError:
        top_overall_keywords = []

    docs_per_topic = documents.groupby(['topic'], as_index=False).agg({'doc': ' '.join})
    
    topic_keywords, all_topic_keywords = {}, {}
    try:
        topic_vectorizer = TfidfVectorizer(stop_words=stop_words, ngram_range=(1, 2))
        topic_tfidf = topic_vectorizer.fit_transform(docs_per_topic['doc'])
        topic_words = topic_vectorizer.get_feature_names_out()
        
        for i, row in docs_per_topic.iterrows():
            topic_num = row['topic']
            topic_tfidf_scores = topic_tfidf[i].toarray().flatten()
            relevant_word_indices = topic_tfidf_scores.argsort()[::-1]
            keywords_with_scores = [{"word": topic_words[j], "score": topic_tfidf_scores[j]} for j in relevant_word_indices[:50] if topic_tfidf_scores[j] > 0.01]
            all_topic_keywords[topic_num] = keywords_with_scores
            top_keywords = [kw['word'] for kw in keywords_with_scores[:10]]
            topic_keywords[topic_num] = ", ".join(top_keywords)
    except ValueError:
        pass

    topic_info_list = [{
        "Topic": t, "Keywords": topic_keywords.get(t, "N/A"), 
        "Count": np.count_nonzero(topics == t), "AllKeywords": all_topic_keywords.get(t, [])
    } for t in np.unique(topics)]
    topic_info = pd.DataFrame(topic_info_list).sort_values(by="Count", ascending=False)
    
    return topic_info, top_overall_keywords, topic_keywords

def analyze_papers(papers, params, embedding_model, stop_words, precomputed_data=None, main_author_name=None, vector_cache=None):
    """
    論文データを分析する。
    """
    print("\n[analyzer] Step 1/6: Starting analysis...")
    
    print("[analyzer] Step 2/6: Analyzing co-authors...")
    co_author_data = analyze_co_authorship(papers, main_author_name)
    timeline_data = analyze_timeline_entities(papers, co_author_data)

    if not precomputed_data:
        precomputed_data = {}
    if vector_cache is None:
        vector_cache = {}

    print("[analyzer] Step 3/6: Checking dimensionality reduction (UMAP) cache...")
    
    combined_embeddings = None
    docs = []
    pids_with_abs = []
    reduced_10d = None
    reduced_2d = None

    # 1. UMAPキャッシュの確認
    if 'reduced_10d' in precomputed_data and 'reduced_2d' in precomputed_data:
        print("[analyzer] Using cached UMAP results.")
        reduced_10d = precomputed_data['reduced_10d']
        reduced_2d = precomputed_data['reduced_2d']
        combined_embeddings = precomputed_data.get('combined_embeddings')
        docs = precomputed_data.get('docs', [])
        pids_with_abs = precomputed_data.get('pids_with_abs', [])
        
        if combined_embeddings is None or not docs or not pids_with_abs:
             print("[analyzer] Error: UMAP cache incomplete. Recomputing...")
             precomputed_data = {}
             reduced_10d = None # Reset to force recompute
    else:
        print("[analyzer] No valid UMAP cache found.")

    # 2. ベクトル化 (必要な場合)
    if reduced_10d is None:
        if 'combined_embeddings' in precomputed_data:
             print("[analyzer] Using cached 'combined_embeddings'.")
             combined_embeddings = precomputed_data['combined_embeddings']
             docs = precomputed_data.get('docs', [])
             pids_with_abs = precomputed_data.get('pids_with_abs', [])
             if not docs or not pids_with_abs:
                 print("[analyzer] Error: Embeddings cache incomplete. Recomputing...")
                 combined_embeddings, docs, pids_with_abs = _get_embeddings(papers, params, embedding_model, vector_cache)
        else:
             combined_embeddings, docs, pids_with_abs = _get_embeddings(papers, params, embedding_model, vector_cache)
        
        if combined_embeddings is None: # Not enough docs
             return {"papers": papers, "topic_info": pd.DataFrame(), "dendrogram_data": None, "top_overall_keywords": [], "precomputed_data": {}, "co_author_data": co_author_data, "timeline_data": timeline_data}

        # Cache embeddings
        precomputed_data['docs'] = docs
        precomputed_data['pids_with_abs'] = pids_with_abs
        precomputed_data['combined_embeddings'] = combined_embeddings

        # 3. 次元削減
        reduced_10d, reduced_2d = _reduce_dimensions(combined_embeddings, params)
        precomputed_data['reduced_10d'] = reduced_10d
        precomputed_data['reduced_2d'] = reduced_2d

    # 4. クラスタリング
    topics, dendrogram_tree = _cluster_papers(reduced_10d, params, docs)

    # --- Re-index topics by size (User Request) ---
    # Topic -1 (Noise) should remain -1. Other topics should be sorted 0, 1, 2... by size.
    unique_topics, counts = np.unique(topics, return_counts=True)
    topic_counts = dict(zip(unique_topics, counts))
    
    # Sort regular topics by count (descending)
    sorted_topics = sorted([t for t in unique_topics if t != -1], key=lambda t: topic_counts[t], reverse=True)
    
    # Create mapping: Old ID -> New ID
    topic_map = {old_id: new_id for new_id, old_id in enumerate(sorted_topics)}
    if -1 in topic_counts:
        topic_map[-1] = -1
        
    # Apply mapping
    topics = np.array([topic_map[t] for t in topics])
    print("[analyzer] Re-indexed topics by size.")
    # ---------------------------------------------

    # 5. キーワード抽出
    topic_info, top_overall_keywords, topic_keywords = _extract_keywords(docs, topics, stop_words)

    # 結果の統合
    for i, pid in enumerate(pids_with_abs):
        topic_num = topics[i]
        papers[pid].update({
            "topic": int(topic_num), "topic_keywords": topic_keywords.get(topic_num, "N/A"),
            "embedding_2d": reduced_2d[i].tolist()
        })
    
    print("[analyzer] Analysis complete. Returning data.")
    return {
        "papers": papers, "topic_info": topic_info, "dendrogram_data": dendrogram_tree,
        "top_overall_keywords": top_overall_keywords, "precomputed_data": precomputed_data,
        "co_author_data": co_author_data,
        "timeline_data": timeline_data
    }