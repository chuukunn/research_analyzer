from data_fetcher import fetch_papers

aid = "50663909" # G. Andrienko
papers, name, error = fetch_papers("semantic_scholar", aid, 1000)

if error:
    print(f"ERROR: {error}")
else:
    total = len(papers)
    with_abstract = sum(1 for p in papers.values() if p.get('abstract'))
    print(f"Total Papers: {total}")
    print(f"With Abstract: {with_abstract}")
    print(f"Without Abstract: {total - with_abstract}")
