import requests

def search_author(name):
    url = "https://api.semanticscholar.org/graph/v1/author/search"
    params = {"query": name, "fields": "authorId,name,paperCount"}
    import json
    r = requests.get(url, params=params)
    data = r.json()
    with open("found_authors.txt", "w", encoding="utf-8") as f:
        for author in data.get('data', []):
            f.write(f"Name: {author['name']}, ID: {author['authorId']}, Papers: {author['paperCount']}\n")
    print("Done writing to found_authors.txt")

if __name__ == "__main__":
    search_author("Gennady Andrienko")
