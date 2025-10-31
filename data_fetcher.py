import pyalex

def to_local(w):
    abstract_text = ""
    # Inverted indexからAbstractを再構築
    if inv_index := w.get("abstract_inverted_index"):
        if isinstance(inv_index, dict):
            abstract_text = " ".join(
                [word for word, _ in sorted(inv_index.items(), key=lambda item: item[1][0])]
            )
    
    authorships = []
    if w.get('authorships'):
        for au in w.get('authorships', []):
            if au.get('author'):
                authorships.append({
                    "name": au['author'].get('display_name'),
                    "position": au.get('author_position', 'middle')
                })

    # 全著者の所属機関リストを取得
    institution_names = []
    if w.get('authorships'):
        for au in w.get('authorships', []):
            if au.get('institutions'):
                for inst in au.get('institutions', []):
                    if inst_name := inst.get('display_name'):
                        if inst_name not in institution_names:
                            institution_names.append(inst_name)

    # [修正点 1] PDFのURL (Open Access URL) を取得
    pdf_url = w.get("open_access", {}).get("oa_url") or ""

    return {
        "paper_id": w['id'].split("/")[-1],
        "title": w.get("title", ""),
        "year": w.get("publication_year") or 0,
        "abstract": abstract_text,
        # "authors" は authorships から名前のリストを抽出して後方互換性を維持
        "authors": [au['name'] for au in authorships if au.get('name')],
        "authorships": authorships, # 筆頭著者情報を含む完全なリスト
        "references": [ref.split("/")[-1] for ref in w.get("referenced_works", []) if ref],
        "cit_cnt": w.get("cited_by_count", 0),
        "type": w.get("type", "article"),
        "type_crossref": w.get("type_crossref", "journal-article"), # 博士論文の識別に利用
        "venue_name": w.get("host_venue", {}).get("display_name"),
        "institution_names": institution_names,
        "pdf_url": pdf_url  # [修正点 1] pdf_url を追加
    }

def fetch_papers_from_openalex(author_id, max_papers):
    """指定された著者IDの論文をOpenAlexから取得する"""
    pyalex.config.email = "gemini.test.2024@example.com"
    try:
        # Paginatorを準備
        works_pager = pyalex.Works().filter(author={"id": author_id}).sort(publication_date="desc").paginate(per_page=200, n_max=max_papers)
        
        papers = {}
        main_author_name = None # 初期値はNone

        # 全ページをループ処理
        for page in works_pager:
            for work in page:
                # 辞書に論文データを追加
                paper_id = work["id"].split("/")[-1]
                papers[paper_id] = to_local(work)
                
                # まだ主著者の名前が見つかっていない場合、この論文から探す
                if main_author_name is None:
                    for authorship in work.get('authorships', []):
                        # OpenAlexのIDはURL形式なので、末尾で比較する
                        if authorship.get('author', {}).get('id', '').endswith(author_id):
                            main_author_name = authorship['author'].get('display_name')
                            # 見つかったら、この論文の著者ループは抜ける
                            break 
        
        # もし万が一、主著者の名前が見つからなかった場合のフォールバック
        if main_author_name is None:
            main_author_name = ""

        return papers, main_author_name, None
    except Exception as e:
        return None, None, str(e)
