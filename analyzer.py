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

def analyze_papers(papers, params, embedding_model, stop_words, precomputed_data=None, main_author_name=None, vector_cache=None):
    """
    論文データを分析する。precomputed_dataがあれば一部の処理をスキップする。
    ★ vector_cache を使用して論文ごとのベクトル化をキャッシュする
    """
    print("\n[analyzer] Step 1/6: Starting analysis...")
    
    # --- 1. 事前分析 (共著者、タイムライン) ---
    print("[analyzer] Step 2/6: Analyzing co-authors...")
    co_author_data = analyze_co_authorship(papers, main_author_name)
    timeline_data = analyze_timeline_entities(papers, co_author_data)

    if not precomputed_data:
        precomputed_data = {}
    if vector_cache is None:
        vector_cache = {}

    # --- 2. 次元削減キャッシュの確認 ---
    print("[analyzer] Step 3/6: Checking dimensionality reduction (UMAP) cache...")
    if 'reduced_10d' in precomputed_data and 'reduced_2d' in precomputed_data:
        print("[analyzer] Using cached UMAP results (reduced_10d, reduced_2d). Skipping vectorization and UMAP.")
        reduced_10d = precomputed_data['reduced_10d']
        reduced_2d = precomputed_data['reduced_2d']
        # UMAPがキャッシュされている = combined_embeddings もキャッシュされているはず
        combined_embeddings = precomputed_data.get('combined_embeddings') 
        # docs と pids_with_abs も必要
        docs = precomputed_data.get('docs', [])
        pids_with_abs = precomputed_data.get('pids_with_abs', [])
        
        # 必要なデータが揃っているか最終確認
        if combined_embeddings is None or not docs or not pids_with_abs:
             print("[analyzer] Error: UMAP cache was present but other precomputed data (embeddings/docs) was missing. Recomputing...")
             precomputed_data = {} # キャッシュをリセットして再計算
        
    else:
        print("[analyzer] No valid UMAP cache found.")
        # --- 3. ベクトル化 (★ 論文ごとキャッシュ利用) ---
        print("[analyzer] Step 4/6: Embedding (Vectorization)...")
        
        if 'combined_embeddings' in precomputed_data:
            print("[analyzer] Using cached 'combined_embeddings' from precomputed_data.")
            combined_embeddings = precomputed_data['combined_embeddings']
            docs = precomputed_data.get('docs', [])
            pids_with_abs = precomputed_data.get('pids_with_abs', [])
            if not docs or not pids_with_abs:
                print("[analyzer] Error: 'combined_embeddings' cache was present but docs/pids missing. Recomputing...")
                precomputed_data = {} # リセット
        
        # 'combined_embeddings' が precomputed_data にない場合、論文ごとキャッシュを使って生成
        if 'combined_embeddings' not in precomputed_data:
            print(f"[analyzer] Generating embeddings using global vector_cache (cache size: {len(vector_cache)})...")
            
            # 3a. 分析対象の論文リストを作成
            docs, pids_with_abs, years = [], [], []
            
            # ★ 修正点: 最小単語数を定義
            MIN_ABSTRACT_WORDS = 50

            for pid, p in papers.items():
                # ★ 修正: and len(abs_text.split()) >= MIN_ABSTRACT_WORDS を追加
                if (abs_text := (p.get("abstract") or "").strip()) and p.get("year") and len(abs_text.split()) >= MIN_ABSTRACT_WORDS:
                    docs.append(abs_text)
                    pids_with_abs.append(pid)
                    years.append(p["year"])
                else:
                    # フィルター（アブストラクトなし、年なし、または単語数不足）
                    p.update({"topic": -1, "topic_keywords": "N/A", "embedding_2d": []})
            
            if not docs or len(docs) < params.get('n_neighbors', 15):
                print("[analyzer] Not enough documents for analysis. Skipping.")
                return {"papers": papers, "topic_info": pd.DataFrame(), "dendrogram_data": None, "top_overall_keywords": [], "precomputed_data": {}, "co_author_data": co_author_data, "timeline_data": timeline_data}
            
            print(f"[analyzer] Found {len(docs)} documents with abstract (>= {MIN_ABSTRACT_WORDS} words) and year for analysis.")
            
            # 3b. 論文ごとキャッシュを確認し、ベクトル化が必要なリストを作成
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
            
            # 3c. 新規論文のベクトル化
            if docs_to_encode_texts:
                print(f"[analyzer] Running SentenceTransformer.encode() for {len(docs_to_encode_texts)} new documents...")
                new_vectors = embedding_model.encode(docs_to_encode_texts, show_progress_bar=True)
                
                # 3d. 新規ベクトルをキャッシュに保存し、マップに追加
                for i, new_vector in enumerate(new_vectors):
                    original_index = docs_to_encode_indices[i]
                    pid = pids_with_abs[original_index]
                    vector_cache[pid] = new_vector # ★ グローバルキャッシュを更新
                    content_vectors_map[pid] = new_vector
                print(f"[analyzer] Encoding complete. Updated vector_cache size: {len(vector_cache)}")
            
            # 3e. 論文ベクトルを正しい順序でNumpy配列に再構築
            content_embeddings_list = [content_vectors_map[pid] for pid in pids_with_abs]
            content_embeddings = np.array(content_embeddings_list)
            
            # 3f. 時間重み付け
            if params.get('time_weight', 0) > 0:
                print(f"[analyzer] Applying time_weight: {params['time_weight']}")
                year_scaler = MinMaxScaler()
                time_vector = year_scaler.fit_transform(np.array(years).reshape(-1, 1))
                weighted_time_vector = time_vector * params['time_weight']
                combined_embeddings = np.hstack([content_embeddings, weighted_time_vector])
            else:
                combined_embeddings = content_embeddings
            
            # 3g. precomputed_data に保存
            precomputed_data['docs'] = docs
            precomputed_data['pids_with_abs'] = pids_with_abs
            precomputed_data['combined_embeddings'] = combined_embeddings

        # --- 4. 次元削減 (UMAP) ---
        print(f"[analyzer] Step 5/6: Reducing dimensions with UMAP (n_neighbors={params['n_neighbors']}, min_dist={params['min_dist']})...")
        
        # クラスタリング用の高次元埋め込み(10D) - パラメータ固定
        umap_cluster_model = umap.UMAP(n_neighbors=15, n_components=10, min_dist=0.1, random_state=42)
        reduced_10d = umap_cluster_model.fit_transform(combined_embeddings)
            
        # 可視化用の2D埋め込み - パラメータ可変
        umap_viz_model = umap.UMAP(n_neighbors=params['n_neighbors'], n_components=2, min_dist=params['min_dist'], random_state=42)
        reduced_2d = umap_viz_model.fit_transform(combined_embeddings)

        # 4a. precomputed_data に保存
        precomputed_data['reduced_10d'] = reduced_10d
        precomputed_data['reduced_2d'] = reduced_2d

    # --- 5. クラスタリング ---
    print(f"[analyzer] Step 6/6: Clustering with {params['clustering_model']} (k={params['k']})...")
    clusterer_model = params['clustering_model'].lower()
    dendrogram_tree = None

    # HDBSCANのmin_cluster_sizeを固定値に設定。これによりkを変更してもデンドログラムの構造が安定する。
    HDBSCAN_MIN_CLUSTER_SIZE = 5

    if clusterer_model == 'hdbscan':
        # デンドログラム生成用に、固定パラメータでHDBSCANを一度実行する
        hdbscan_clusterer_for_dendrogram = hdbscan.HDBSCAN(
            min_cluster_size=HDBSCAN_MIN_CLUSTER_SIZE, 
            min_samples=1, 
            gen_min_span_tree=True
        )
        hdbscan_clusterer_for_dendrogram.fit(reduced_10d)
        
        try:
            # ユーザー指定のクラスタ数 'k' でフラットなクラスタリングを実行する
            flat_clusterer = HDBSCAN_flat(
                reduced_10d, 
                n_clusters=params['k'], 
                min_cluster_size=HDBSCAN_MIN_CLUSTER_SIZE
            )
            topics = flat_clusterer.labels_
        except Exception as e:
            print(f"[analyzer] HDBSCAN_flat clustering failed with k={params['k']}. Error: {e}")
            print(f"[analyzer] Falling back to default HDBSCAN clustering result.")
            # flat clustering が失敗した場合は、デンドログラム生成に使ったインスタンスの結果をフォールバックとして使用
            topics = hdbscan_clusterer_for_dendrogram.labels_
        
        # デンドログラムデータは、固定パラメータで実行したインスタンスから生成
        linkage_matrix = hdbscan_clusterer_for_dendrogram.single_linkage_tree_.to_numpy()
        def build_tree(node, linkage, n_samples):
            if node.is_leaf(): return {"name": f"doc_{node.id}", "size": 1}
            distance = linkage[node.id - n_samples][2] if (node.id - n_samples) < len(linkage) else 0
            return {"name": f"node_{node.id}", "distance": distance, "children": [build_tree(node.get_left(), linkage, n_samples), build_tree(node.get_right(), linkage, n_samples)]}
        n_samples = len(docs)
        root_node = to_tree(linkage_matrix, rd=True)
        dendrogram_tree = build_tree(root_node[0], linkage_matrix, n_samples) if root_node else None

    elif clusterer_model == 'kmeans':
        # params['k'] には、UIから指定されたk-means用のkの値が入っている
        kmeans_clusterer = KMeans(n_clusters=params['k'], random_state=42, n_init=10)
        topics = kmeans_clusterer.fit_predict(reduced_10d)
        # K-Meansは階層的ではないため、デンドログラムは生成しない
        dendrogram_tree = None
    else: # デフォルトはHDBSCAN（UIからの選択肢外）
        hdbscan_clusterer = hdbscan.HDBSCAN(min_cluster_size=params['k'], min_samples=1, gen_min_span_tree=False)
        topics = hdbscan_clusterer.fit_predict(reduced_10d)
        dendrogram_tree = None

    # トピックが-1（未分類）の論文を新しいトピック番号に割り当てる
    if -1 in topics:
        max_topic_num = np.max(topics)
        # -1しかない場合(max_topic_numが-1)は新しいトピックを0とする
        new_topic_num = max_topic_num + 1 if max_topic_num > -1 else 0
        topics[topics == -1] = new_topic_num
        print(f"[analyzer] Unclassified documents (-1) assigned to new topic {new_topic_num}.")

    print("[analyzer] Generating topic keywords and top overall keywords...")
    documents = pd.DataFrame({"doc": docs, "topic": topics})
    
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
    
    try:
        topic_vectorizer = TfidfVectorizer(stop_words=stop_words, ngram_range=(1, 2))
        topic_tfidf = topic_vectorizer.fit_transform(docs_per_topic['doc'])
        topic_words = topic_vectorizer.get_feature_names_out()
        
        topic_keywords, all_topic_keywords = {}, {}
        for i, row in docs_per_topic.iterrows():
            topic_num = row['topic']
            topic_tfidf_scores = topic_tfidf[i].toarray().flatten()
            relevant_word_indices = topic_tfidf_scores.argsort()[::-1]
            keywords_with_scores = [{"word": topic_words[j], "score": topic_tfidf_scores[j]} for j in relevant_word_indices[:50] if topic_tfidf_scores[j] > 0.01]
            all_topic_keywords[topic_num] = keywords_with_scores
            top_keywords = [kw['word'] for kw in keywords_with_scores[:10]]
            topic_keywords[topic_num] = ", ".join(top_keywords)
    except ValueError:
        topic_keywords, all_topic_keywords = {}, {}

    topic_info_list = [{
        "Topic": t, "Keywords": topic_keywords.get(t, "N/A"), 
        "Count": np.count_nonzero(topics == t), "AllKeywords": all_topic_keywords.get(t, [])
    } for t in np.unique(topics)]
    topic_info = pd.DataFrame(topic_info_list).sort_values(by="Count", ascending=False)

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

