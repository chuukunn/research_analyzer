from data_fetcher import fetch_papers

aid = "1780531" # Natalia Andrienko
papers, name, error = fetch_papers("semantic_scholar", aid, 1000)

if error:
    print(f"ERROR: {error}")
else:
    print(f"COUNT: {len(papers)}")
    print(f"NAME: {name}")
