from data_fetcher import fetch_papers

def check_ratio():
    aid = "50663909" # Gennady Andrienko
    print(f"Fetching papers for Author ID: {aid} (Gennady Andrienko)...")
    
    papers, name, error = fetch_papers("semantic_scholar", aid, 1000)
    
    if error:
        print(f"Error: {error}")
        return

    total = len(papers)
    if total == 0:
        print("No papers found.")
        return

    with_abstract = sum(1 for p in papers.values() if p.get('abstract') and p.get('abstract').strip())
    ratio = (with_abstract / total) * 100
    
    print("-" * 30)
    print(f"Author: {name}")
    print(f"Total Papers: {total}")
    print(f"With Abstract: {with_abstract}")
    print(f"Without Abstract: {total - with_abstract}")
    print(f"Ratio: {ratio:.2f}%")
    print("-" * 30)

if __name__ == "__main__":
    check_ratio()
