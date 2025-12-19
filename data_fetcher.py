import pyalex
import requests
import time
import pyalex
import requests
import time
import re

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
            "keywords": p.get("fieldsOfStudy") or p.get("s2FieldsOfStudy") or [], # Added
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
            return papers, main_author_name, None
        except Exception as e:
            return None, None, str(e)

    def fetch_paper(self, paper_id, max_papers):
        """Fetch a single paper and its references/citations"""
        pyalex.config.email = "gemini.test.2024@example.com"
        try:
            # Detect ID format (URL or WID)
            pid = paper_id
            if paper_id.startswith("https://openalex.org/"):
                pid = paper_id.split("/")[-1]
            
            # Fetch the main paper
            main_paper_work = pyalex.Works()[pid]
            if not main_paper_work:
                 return None, None, "Paper not found in OpenAlex."

            std_main = _standardize_paper(main_paper_work, "openalex")
            papers = {std_main["paper_id"]: std_main}
            
            # Main "Author" Name is actually the Paper Title + Type
            main_info_str = f"[Paper] {std_main['title']}"

            # Fetch References (limit by max_papers)
            # references_list is a list of URLs like "https://openalex.org/W..."
            ref_urls = main_paper_work.get("referenced_works", [])
            
            # OpenAlex filter uses IDs. Extract IDs.
            # referenced_works in object usually contains URLs or IDs. 
            # In the standardize function we assumed they are URLs.
            # Check standardizer: [ref.split("/")[-1] for ref in w.get("referenced_works", [])]
            # So they are URLs.
            
            ref_ids = [r.split("/")[-1] for r in ref_urls]
            
            # Fetch referenced papers (batch)
            # Limited by max_papers roughly
            target_ids = ref_ids[:max_papers]
            
            if target_ids:
                # OpenAlex filter has length limits, need chunking? 
                # pyalex handles some chunking but 'filter(openalex_id="...|...")' can be too long.
                # 'filter(ids={"in": [...]})' is not directly supported by pyalex syntax easily?
                # Using 'openalex_id' filter with pipe '|'
                
                # Simple Batching
                batch_size = 50
                for i in range(0, len(target_ids), batch_size):
                    batch = target_ids[i:i+batch_size]
                    batch_str = "|".join(batch)
                    
                    # fetch
                    ref_works = pyalex.Works().filter(openalex_id=batch_str).get()
                    
                    for w in ref_works:
                        std_ref = _standardize_paper(w, "openalex")
                        papers[std_ref["paper_id"]] = std_ref

            print(f"DEBUG: Fetched {len(papers)} papers (1 main + {len(papers)-1} refs).")
            return papers, main_info_str, None

        except Exception as e:
            return None, None, f"OpenAlex Paper Fetch Error: {str(e)}"

class SemanticScholarFetcher(BaseFetcher):
    def fetch(self, author_id, max_papers):
        """Fetch papers from Semantic Scholar GRAPH API"""
        try:
            # Endpoint: https://api.semanticscholar.org/graph/v1/author/<AUTHOR_ID>/papers
            # Fields Documentation: https://api.semanticscholar.org/graph/v1#operation/get_graph_get_author_papers
            fields = "paperId,title,year,abstract,authors,venue,citationCount,openAccessPdf,references.paperId,fieldsOfStudy,s2FieldsOfStudy"
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

    def fetch_paper(self, paper_id, max_papers):
        """Fetch a single paper and its references from Semantic Scholar"""
        try:
             # Endpoint: https://api.semanticscholar.org/graph/v1/paper/<PAPER_ID>
             # Fields: needs references
             fields = "paperId,title,year,abstract,authors,venue,citationCount,openAccessPdf,fieldsOfStudy,s2FieldsOfStudy,references.paperId,references.title,references.year,references.abstract,references.authors,references.venue,references.citationCount,references.openAccessPdf,references.fieldsOfStudy,references.s2FieldsOfStudy"
             
             url = f"https://api.semanticscholar.org/graph/v1/paper/{paper_id}"
             params = {"fields": fields, "limit": 999} # limit for references expansion? Graph API uses 'limit' for nested lists usually

             response = requests.get(url, params=params)
             if response.status_code != 200:
                 return None, None, f"S2 Error: {response.status_code} {response.text}"
             
             data = response.json()
             
             papers = {}
             
             # Main Paper
             std_main = _standardize_paper(data, "semantic_scholar")
             papers[std_main["paper_id"]] = std_main
             main_info_str = f"[Paper] {std_main['title']}"
             
             # References (Expanded in response)
             # "references" key contains list of objects
             if "references" in data:
                 refs = data["references"]
                 # Filter nulls
                 refs = [r for r in refs if r.get("paperId")]
                 
                 # Apply max_papers limit
                 refs = refs[:max_papers]
                 
                 for r in refs:
                     std_ref = _standardize_paper(r, "semantic_scholar")
                     if std_ref.get("paper_id"):
                        papers[std_ref["paper_id"]] = std_ref
             
             print(f"DEBUG: S2 Paper Fetched {len(papers)} papers.")
             return papers, main_info_str, None

        except Exception as e:
            return None, None, f"S2 Paper Fetch Error: {str(e)}"

import os
import json

CACHE_DIR = "cache"
if not os.path.exists(CACHE_DIR):
    os.makedirs(CACHE_DIR)

def fetch_papers(source, id_str, max_papers, force_refetch=False):
    # --- Cache Check ---
    safe_id = re.sub(r'[^a-zA-Z0-9_\-]', '_', id_str)
    cache_path = os.path.join(CACHE_DIR, f"{source}_{safe_id}_{max_papers}.json")

    if not force_refetch and os.path.exists(cache_path):
        print(f"Loading from cache: {cache_path}")
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                cached_data = json.load(f)
                # cached_data should contain: {"papers": ..., "main_info": ...}
                return cached_data.get("papers"), cached_data.get("main_info"), None
        except Exception as e:
            print(f"Cache load failed: {e}")

    # --- Detection Logic ---
    is_paper_id = False
    
    # OpenAlex Paper ID: Starts with 'W' followed by digits, or full URL
    if source == "openalex":
        if re.match(r"^(https://openalex\.org/)?W\d+$", id_str):
            is_paper_id = True
            
    # Semantic Scholar Paper ID: 40-char hex, or 'CorpusId:'
    elif source == "semantic_scholar":
        # S2 Paper ID is usually 40 chars hex.
        if re.match(r"^[0-9a-fA-F]{40}$", id_str) or id_str.lower().startswith("corpusid:"):
            is_paper_id = True

    result_papers = None
    result_main_info = None
    result_error = None

    if is_paper_id:
        print(f"Detected Paper ID input: {id_str} (Source: {source})")
        if source == "openalex":
            result_papers, result_main_info, result_error = OpenAlexFetcher().fetch_paper(id_str, max_papers)
        elif source == "semantic_scholar":
            result_papers, result_main_info, result_error = SemanticScholarFetcher().fetch_paper(id_str, max_papers)
    else:
        # Default to Author Fetch
        if source == "openalex":
            result_papers, result_main_info, result_error = OpenAlexFetcher().fetch(id_str, max_papers)
        elif source == "semantic_scholar":
            result_papers, result_main_info, result_error = SemanticScholarFetcher().fetch(id_str, max_papers)
        else:
            result_papers, result_main_info, result_error = None, None, f"Unknown source: {source}"

    # --- Save to Cache ---
    if result_papers and not result_error:
        try:
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump({"papers": result_papers, "main_info": result_main_info}, f, ensure_ascii=False, indent=2)
            print(f"Saved to cache: {cache_path}")
        except Exception as e:
            print(f"Cache save failed: {e}")

    return result_papers, result_main_info, result_error

# Backward compatibility (if needed)
def fetch_papers_from_openalex(author_id, max_papers):
    return fetch_papers("openalex", author_id, max_papers, force_refetch=False)
