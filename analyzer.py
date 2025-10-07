import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import MinMaxScaler
from sklearn.decomposition import PCA
from sklearn.manifold import TSNE
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

def analyze_institution_collaboration(papers):
    """所属機関の連携ネットワークを分析し、クラスタリングする"""
    if not papers:
        return {"nodes": [], "links": []}

    institution_collaborations = defaultdict(lambda: {'years': [], 'paper_ids': []})
    edges = defaultdict(int)

    for paper_id, p in papers.items():
        institutions = p.get('institution_names', [])
        if len(institutions) < 2:  # 連携がない場合はスキップ
            continue

        for inst in institutions:
            if p['year'] and p['year'] > 0:
                institution_collaborations[inst]['years'].append(p['year'])
                institution_collaborations[inst]['paper_ids'].append(paper_id)

        for inst1, inst2 in itertools.combinations(institutions, 2):
            edge = tuple(sorted((inst1, inst2)))
            edges[edge] += 1

    G = nx.Graph()
    for (u, v), w in edges.items():
        G.add_edge(u, v, weight=w)

    partition = {}
    if G.nodes:
        communities_sets = community.louvain_communities(G, weight='weight', seed=42)
        for i, community_set in enumerate(communities_sets):
            for node in community_set:
                partition[node] = i

    nodes = []
    for inst, data in institution_collaborations.items():
        years = data['years']
        if not years: continue
        nodes.append({
            "id": inst,
            "cluster": partition.get(inst, -1),
            "paper_count": len(data['paper_ids']),
            "start_year": min(years),
            "end_year": max(years)
        })

    links = [{"source": u, "target": v, "weight": w} for (u, v), w in edges.items()]
    return {"nodes": nodes, "links": links}


def analyze_timeline_entities(papers, co_author_data, institution_data):
    """研究グループ、所属機関グループ、論文誌の活動期間を分析する"""
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

    # 2. 所属機関グループ (Institution Groups)
    if institution_data and "nodes" in institution_data:
        group_years = defaultdict(list)
        for inst in institution_data["nodes"]:
            cluster_id = inst.get("cluster")
            if cluster_id is not None and cluster_id != -1:
                group_years[cluster_id].extend([inst["start_year"], inst["end_year"]])

        for cluster_id, years in group_years.items():
            if years:
                timeline_data.append({
                    "name": f"Institution Group {cluster_id}",
                    "start_year": min(years),
                    "end_year": max(years),
                    "category": "Institution"
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
    institutions = sorted([d for d in timeline_data if d['category'] == 'Institution'], key=lambda x: x['start_year'])
    journals = sorted([d for d in timeline_data if d['category'] == 'Journal'], key=lambda x: x['start_year'])
    
    return groups + institutions + journals

def analyze_papers(papers, params, embedding_model, stop_words, precomputed_data=None, main_author_name=None):
    """
    論文データを分析する。precomputed_dataがあれば一部の処理をスキップする。
    """
    co_author_data = analyze_co_authorship(papers, main_author_name)
    institution_data = analyze_institution_collaboration(papers)
    timeline_data = analyze_timeline_entities(papers, co_author_data, institution_data)

    if not precomputed_data:
        precomputed_data = {}

    if 'combined_embeddings' not in precomputed_data:
        print(f"Embedding papers with {params['embedding_model']}...")
        docs, pids_with_abs, years = [], [], []
        for pid, p in papers.items():
            if (abs_text := (p.get("abstract") or "").strip()) and p.get("year"):
                docs.append(abs_text)
                pids_with_abs.append(pid)
                years.append(p["year"])
            else:
                p.update({"topic": -1, "topic_keywords": "N/A", "embedding_2d": []})

        if not docs or len(docs) < params.get('n_neighbors', 15):
            print("分析に必要な論文数が不足しています。")
            return {
                "papers": papers, "topic_info": pd.DataFrame(), "dendrogram_data": None, 
                "top_overall_keywords": [], "precomputed_data": {},
                "co_author_data": co_author_data,
                "institution_data": institution_data,
                "timeline_data": timeline_data
            }
        
        precomputed_data['docs'] = docs
        precomputed_data['pids_with_abs'] = pids_with_abs

        print("論文のベクトル化を実行中...")
        content_embeddings = embedding_model.encode(docs, show_progress_bar=False)
        
        if params.get('time_weight', 0) > 0:
            year_scaler = MinMaxScaler()
            time_vector = year_scaler.fit_transform(np.array(years).reshape(-1, 1))
            weighted_time_vector = time_vector * params['time_weight']
            combined_embeddings = np.hstack([content_embeddings, weighted_time_vector])
        else:
            combined_embeddings = content_embeddings
        precomputed_data['combined_embeddings'] = combined_embeddings
    
    combined_embeddings = precomputed_data['combined_embeddings']
    docs = precomputed_data['docs']
    pids_with_abs = precomputed_data['pids_with_abs']
    
    # --- 2. 次元削減 ---
    print(f"Reducing dimensions with {params['dim_red_model']}...")
    reducer_model = params['dim_red_model'].lower()
    
    # クラスタリング用の高次元埋め込み(10D or 3D for t-SNE)
    if reducer_model == 'umap':
        umap_cluster_model = umap.UMAP(n_neighbors=15, n_components=10, min_dist=0.1, random_state=42)
        reduced_10d = umap_cluster_model.fit_transform(combined_embeddings)
    elif reducer_model == 'pca':
        pca_model = PCA(n_components=10, random_state=42)
        reduced_10d = pca_model.fit_transform(combined_embeddings)
    elif reducer_model == 'tsne':
        # Barnes-Hut t-SNE, the default for large N, requires n_components <= 3.
        # We use 3 components as input for the subsequent clustering step.
        tsne_model = TSNE(n_components=3, random_state=42, perplexity=min(30, len(combined_embeddings)-1))
        reduced_10d = tsne_model.fit_transform(combined_embeddings)
    else: # デフォルトはUMAP
        umap_cluster_model = umap.UMAP(n_neighbors=15, n_components=10, min_dist=0.1, random_state=42)
        reduced_10d = umap_cluster_model.fit_transform(combined_embeddings)
        
    # 可視化用の2D埋め込み
    if reducer_model == 'umap':
        umap_viz_model = umap.UMAP(n_neighbors=params['n_neighbors'], n_components=2, min_dist=params['min_dist'], random_state=42)
        reduced_2d = umap_viz_model.fit_transform(combined_embeddings)
    elif reducer_model == 'pca':
        pca_model_2d = PCA(n_components=2, random_state=42)
        reduced_2d = pca_model_2d.fit_transform(combined_embeddings)
    elif reducer_model == 'tsne':
        tsne_model_2d = TSNE(n_components=2, random_state=42, perplexity=min(30, len(combined_embeddings)-1))
        reduced_2d = tsne_model_2d.fit_transform(combined_embeddings)
    else: # デフォルトはUMAP
        umap_viz_model = umap.UMAP(n_neighbors=params['n_neighbors'], n_components=2, min_dist=params['min_dist'], random_state=42)
        reduced_2d = umap_viz_model.fit_transform(combined_embeddings)

    # --- 3. クラスタリング ---
    print(f"Clustering with {params['clustering_model']}...")
    clusterer_model = params['clustering_model'].lower()
    dendrogram_tree = None
    
    if clusterer_model == 'hdbscan':
        hdbscan_clusterer = hdbscan.HDBSCAN(min_cluster_size=params['k'], min_samples=1, gen_min_span_tree=True)
        hdbscan_clusterer.fit(reduced_10d)
        try:
            flat_clusterer = HDBSCAN_flat(reduced_10d, n_clusters=params['k'], min_cluster_size=2)
            topics = flat_clusterer.labels_
        except Exception:
            topics = hdbscan_clusterer.labels_
        
        # デンドログラムデータ生成
        linkage_matrix = hdbscan_clusterer.single_linkage_tree_.to_numpy()
        def build_tree(node, linkage, n_samples):
            if node.is_leaf(): return {"name": f"doc_{node.id}", "size": 1}
            distance = linkage[node.id - n_samples][2] if (node.id - n_samples) < len(linkage) else 0
            return {"name": f"node_{node.id}", "distance": distance, "children": [build_tree(node.get_left(), linkage, n_samples), build_tree(node.get_right(), linkage, n_samples)]}
        n_samples = len(docs)
        root_node = to_tree(linkage_matrix, rd=True)
        dendrogram_tree = build_tree(root_node[0], linkage_matrix, n_samples) if root_node else None

    elif clusterer_model == 'kmeans':
        kmeans_clusterer = KMeans(n_clusters=params['k'], random_state=42, n_init=10)
        topics = kmeans_clusterer.fit_predict(reduced_10d)
        # K-Meansは階層的ではないため、デンドログラムは生成しない
        dendrogram_tree = None
    else: # デフォルトはHDBSCAN
        hdbscan_clusterer = hdbscan.HDBSCAN(min_cluster_size=params['k'], min_samples=1, gen_min_span_tree=True)
        topics = hdbscan_clusterer.fit_predict(reduced_10d)
        dendrogram_tree = None # Not implemented for default case

    print("トピックキーワードと全体キーワードを生成中...")
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
            if topic_num == -1: continue
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
    
    return {
        "papers": papers, "topic_info": topic_info, "dendrogram_data": dendrogram_tree,
        "top_overall_keywords": top_overall_keywords, "precomputed_data": precomputed_data,
        "co_author_data": co_author_data,
        "institution_data": institution_data,
        "timeline_data": timeline_data
    }
