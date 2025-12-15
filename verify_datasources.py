import sys
import os

# Add current directory to path
sys.path.append(os.getcwd())

from data_fetcher import fetch_papers

def test_fetch_openalex():
    print("Testing OpenAlex Fetcher...")
    # Use a known OpenAlex Author ID (e.g., from existing code default or previous conv)
    # a5086198262 is the default in main.py
    aid = "a5086198262" 
    papers, name, error = fetch_papers("openalex", aid, 5)
    
    if error:
        print(f"FAILED: {error}")
        return

    print(f"Success! Name: {name}")
    print(f"Fetched {len(papers)} papers.")
    if len(papers) > 0:
        first_paper = list(papers.values())[0]
        print(f"Sample Paper Keys: {list(first_paper.keys())}")
        required_keys = ["paper_id", "title", "year", "abstract", "authors", "source"]
        for k in required_keys:
            if k not in first_paper:
                print(f"MISSING: {k}")
    print("-" * 20)

def test_fetch_semantic_scholar():
    print("Testing Semantic Scholar Fetcher...")
    # Use a known Semantic Scholar Author ID. 
    # Example: Natalia Andrienko (1780833)
    aid = "1780833"
    papers, name, error = fetch_papers("semantic_scholar", aid, 1000)
    
    if error:
        print(f"FAILED: {error}")
        return

    print(f"Success! Name: {name}")
    print(f"Fetched {len(papers)} papers.")
    if len(papers) > 0:
        first_paper = list(papers.values())[0]
        print(f"First Paper Title: {first_paper.get('title')}")
        print(f"First Paper Date: {first_paper.get('year')}")
        print(f"Sample Paper Keys: {list(first_paper.keys())}")
        required_keys = ["paper_id", "title", "year", "abstract", "authors", "source"]
        for k in required_keys:
            if k not in first_paper:
                print(f"MISSING: {k}")
        print(f"Checking source field: {first_paper.get('source')}")
    print("-" * 20)

if __name__ == "__main__":
    test_fetch_openalex()
    print("\n" + "="*30 + "\n")
    test_fetch_semantic_scholar()
