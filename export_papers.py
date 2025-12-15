import csv
import sys
from data_fetcher import fetch_papers

def export_papers():
    source = "semantic_scholar"
    aid = "50663909" # Gennady Andrienko
    max_papers = 1000
    output_file = "fetched_papers_list.csv"

    print(f"Fetching papers for {aid} from {source}...")
    papers, name, error = fetch_papers(source, aid, max_papers)

    if error:
        print(f"Error fetching papers: {error}")
        return

    print(f"Fetched {len(papers)} papers. Writing to {output_file}...")

    try:
        with open(output_file, mode='w', newline='', encoding='utf-8') as csvfile:
            fieldnames = ['paper_id', 'year', 'has_abstract', 'title', 'citation_count']
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)

            writer.writeheader()
            for pid, p in papers.items():
                writer.writerow({
                    'paper_id': p.get('paper_id'),
                    'year': p.get('year'),
                    'has_abstract': bool(p.get('abstract') and p.get('abstract').strip()),
                    'title': p.get('title'),
                    'citation_count': p.get('cit_cnt')
                })
        print("Done.")
    except Exception as e:
        print(f"Error writing CSV: {e}")

if __name__ == "__main__":
    export_papers()
