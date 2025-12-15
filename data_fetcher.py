import pyalex
import requests
import time

# --- Helper Functions ---
def _standardize_paper(source_data, source_type):
    """
    Convert raw data from different sources into a standard format.
    Standard Format:
    {
        "paper_id": str,
        "title": str,
        "year": int,
        "abstract": str,
        "authors": list[str], # List of names
        "authorships": list[dict], # Extended info: [{"name":..., "position":..., "affiliations":...}]
        "references": list[str], # List of IDs
        "cit_cnt": int,
        "type": str,
        "venue_name": str,
        "institution_names": list[str],
        "pdf_url": str
    }
    """
    if source_type == "openalex":
        w = source_data
        abstract_text = ""
        # Inverted indexからAbstractを再構築
        if inv_index := w.get("abstract_inverted_index"):
            if isinstance(inv_index, dict):
                abstract_text = " ".join(
                    [word for word, _ in sorted(inv_index.items(), key=lambda item: item[1][0])]
                )
        
        authorships = []
        institution_names = []
        if w.get('authorships'):
            for au in w.get('authorships', []):
                # Author Info
                if au.get('author'):
                    authorships.append({
                        "name": au['author'].get('display_name'),
                        "position": au.get('author_position', 'middle'),
                        "id": au['author'].get('id')
                    })
                # Institution Info
                if au.get('institutions'):
                    for inst in au.get('institutions', []):
                        if inst_name := inst.get('display_name'):
                            if inst_name not in institution_names:
                                institution_names.append(inst_name)

        return {
            "paper_id": w['id'].split("/")[-1],
            "title": w.get("title", ""),
            "year": w.get("publication_year") or 0,
            "abstract": abstract_text,
            "authors": [au['name'] for au in authorships if au.get('name')],
            "authorships": authorships,
            "references": [ref.split("/")[-1] for ref in w.get("referenced_works", []) if ref],
            "cit_cnt": w.get("cited_by_count", 0),
            "type": w.get("type", "article"),
            "venue_name": w.get("host_venue", {}).get("display_name"),
            "institution_names": institution_names,
            "pdf_url": w.get("open_access", {}).get("oa_url") or "",
            "source": "openalex"
        }

    elif source_type == "semantic_scholar":
        p = source_data
        
        # Abstract
        abstract_text = p.get("abstract") or ""

        # Authors
        authorships = []
        # Handle case where "authors" key exists but is None
        raw_authors = p.get("authors") or []
        for au in raw_authors:
            authorships.append({
                "name": au.get("name"),
                "id": au.get("authorId"),
                "position": "unknown" 
            })
        
        # References
        refs = []
        raw_refs = p.get("references") or []
        for ref in raw_refs:
            if ref.get("paperId"):
                refs.append(str(ref["paperId"]))

        return {
            "paper_id": p.get("paperId", ""),
            "title": p.get("title", ""),
            "year": p.get("year") or 0,
            "abstract": abstract_text,
            "authors": [au["name"] for au in authorships if au.get("name")],
            "authorships": authorships,
            "references": refs,
            "cit_cnt": p.get("citationCount", 0),
            "type": "article", 
            "venue_name": p.get("venue"),
            "institution_names": [],
            "pdf_url": p.get("openAccessPdf", {}).get("url") if p.get("openAccessPdf") else "",
            "source": "semantic_scholar"
        }
    
    return {}

class BaseFetcher:
    def fetch(self, author_id, max_papers):
        raise NotImplementedError

class OpenAlexFetcher(BaseFetcher):
    def fetch(self, author_id, max_papers):
        """指定された著者IDの論文をOpenAlexから取得する"""
        pyalex.config.email = "gemini.test.2024@example.com"
        try:
            # Paginatorを準備
            works_pager = pyalex.Works().filter(author={"id": author_id}).sort(publication_date="desc").paginate(per_page=200, n_max=max_papers)
            
            papers = {}
            main_author_name = None

            for page in works_pager:
                for work in page:
                    std_paper = _standardize_paper(work, "openalex")
                    paper_id = std_paper["paper_id"]
                    papers[paper_id] = std_paper
                    
                    if main_author_name is None:
                        for authorship in work.get('authorships', []):
                            # Safe extraction of ID
                            auth_id = str(authorship.get('author', {}).get('id') or '')
                            # Case-insensitive comparison
                            if auth_id.lower().endswith(author_id.lower()):
                                main_author_name = authorship['author'].get('display_name')
                                break 
            
            if main_author_name is None:
                main_author_name = ""

            return papers, main_author_name, None
        except Exception as e:
            return None, None, str(e)

class SemanticScholarFetcher(BaseFetcher):
    def fetch(self, author_id, max_papers):
        """Fetch papers from Semantic Scholar GRAPH API"""
        try:
            # Endpoint: https://api.semanticscholar.org/graph/v1/author/<AUTHOR_ID>/papers
            # Fields Documentation: https://api.semanticscholar.org/graph/v1#operation/get_graph_get_author_papers
            fields = "paperId,title,year,abstract,authors,venue,citationCount,openAccessPdf,references.paperId"
            url = f"https://api.semanticscholar.org/graph/v1/author/{author_id}/papers"
            
            params = {
                "fields": fields,
                "limit": min(max_papers, 999) # S2 max limit per page is often 1000
            }
            
            # print(f"DEBUG: S2 URL: {url} Params: {params}")

            all_papers = []
            
            # Retry logic for Rate Limits (429)
            max_retries = 3
            for attempt in range(max_retries):
                response = requests.get(url, params=params)
                if response.status_code == 429:
                    print(f"DEBUG: Rate limit hit (429). Retrying in 5 seconds... (Attempt {attempt+1}/{max_retries})")
                    time.sleep(5)
                    continue
                if response.status_code != 200:
                   print(f"DEBUG: S2 Error Status: {response.status_code} Body: {response.text}")
                response.raise_for_status()
                break # Success
            else:
                 return None, None, "API Rate Limit Exceeded. Please try again later."

            data = response.json()
            
            # S2 returns {"data": [...], "next": ...}
            if "data" in data:
                all_papers.extend(data["data"])
            else:
                print(f"DEBUG: 'data' key missing or empty. Response keys: {data.keys()}")
            
            print(f"DEBUG: S2 fetched {len(all_papers)} raw papers.")
            
            papers = {}
            main_author_name = "" 
            
            try:
                r_auth = requests.get(f"https://api.semanticscholar.org/graph/v1/author/{author_id}", params={"fields": "name"})
                if r_auth.status_code == 200:
                    main_author_name = r_auth.json().get("name", "")
            except:
                pass

            for p in all_papers:
                std_paper = _standardize_paper(p, "semantic_scholar")
                if std_paper.get("paper_id"):
                    papers[std_paper["paper_id"]] = std_paper

            return papers, main_author_name, None

        except Exception as e:
            return None, None, f"Semantic Scholar Error: {str(e)}"

def fetch_papers(source, author_id, max_papers):
    if source == "openalex":
        return OpenAlexFetcher().fetch(author_id, max_papers)
    elif source == "semantic_scholar":
        return SemanticScholarFetcher().fetch(author_id, max_papers)
    else:
        return None, None, f"Unknown source: {source}"

# Backward compatibility (if needed)
def fetch_papers_from_openalex(author_id, max_papers):
    return fetch_papers("openalex", author_id, max_papers)
