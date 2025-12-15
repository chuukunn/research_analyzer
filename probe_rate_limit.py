import requests

def check_rate_limits():
    url = "https://api.semanticscholar.org/graph/v1/author/50663909/papers"
    params = {"fields": "paperId", "limit": 1}
    
    print("Sending request to check headers...")
    try:
        r = requests.get(url, params=params)
        print(f"Status Code: {r.status_code}")
        print("--- Rate Limit Headers ---")
        for k, v in r.headers.items():
            if 'rate' in k.lower() or 'limit' in k.lower():
                print(f"{k}: {v}")
        print("--------------------------")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_rate_limits()
