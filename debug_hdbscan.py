import sys
import os
import numpy as np
import pandas as pd
from unittest.mock import MagicMock

# Add project dir to path
sys.path.append(os.getcwd())

import analyzer

# Mock embedding model
mock_model = MagicMock()
# Generate random data but with some structure to allow clustering
# 3 clusters of 30 points each + 10 noise
np.random.seed(42)
c1 = np.random.normal(0, 0.5, (30, 768))
c2 = np.random.normal(5, 0.5, (30, 768))
c3 = np.random.normal(10, 0.5, (30, 768))
noise = np.random.uniform(-5, 15, (10, 768))
vectors = np.vstack([c1, c2, c3, noise])
mock_model.encode.return_value = vectors

# Create dummy papers
papers = {}
for i in range(100):
    papers[str(i)] = {
        "abstract": "This is a dummy abstract " * 10,
        "title": f"Paper {i}",
        "year": 2020 + (i % 5)
    }

def test_clustering(k):
    params = {
        "k": k,
        "time_weight": 0,
        "n_neighbors": 15,
        "min_dist": 0.1,
        "clustering_model": "hdbscan"
    }
    
    print(f"\n--- Testing with k (min_cluster_size) = {k} ---")
    
    # We need to reload analyzer or just trust that the file change is picked up if we run a new process.
    # Since I run `python debug_hdbscan.py` as a command, it will pick up changes on disk.
    
    result = analyzer.analyze_papers(
        papers=papers.copy(),
        params=params,
        embedding_model=mock_model,
        stop_words=[],
        precomputed_data=None,
        main_author_name="Test Author"
    )
    
    topics = [p['topic'] for p in result['papers'].values()]
    topic_counts = pd.Series(topics).value_counts().sort_index()
    print(f"Topic counts:\n{topic_counts}")
    return len(topic_counts[topic_counts.index != -1])

# Test with different k values
k_values = [5, 15, 30]
results = {}
for k in k_values:
    results[k] = test_clustering(k)

print("\n--- Summary ---")
for k, count in results.items():
    print(f"k={k}: {count} clusters found")
