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
mock_model.encode.return_value = np.random.rand(100, 768)

# Create dummy papers
papers = {}
for i in range(100):
    papers[str(i)] = {
        "abstract": "This is a dummy abstract " * 10,
        "title": f"Paper {i}",
        "year": 2020 + (i % 5)
    }

# Params with high k to force noise
params = {
    "k": 50, # High min_cluster_size for 100 points -> likely noise
    "time_weight": 0,
    "n_neighbors": 15,
    "min_dist": 0.1,
    "clustering_model": "hdbscan"
}

print("Running analyze_papers with high k to force noise...")
# We need to mock UMAP to avoid slow computation and ensure we get some output
# But analyzer.py imports umap. 
# Let's just run it. 100 points is fast.

try:
    result = analyzer.analyze_papers(
        papers=papers,
        params=params,
        embedding_model=mock_model,
        stop_words=[],
        precomputed_data=None,
        main_author_name="Test Author"
    )
    
    topics = [p['topic'] for p in result['papers'].values()]
    
    print(f"Topics found: {set(topics)}")
    
    if -1 in topics:
        print("SUCCESS: Found -1 in topics. Noise is preserved.")
    else:
        # It's possible HDBSCAN found a cluster even with k=50 if data is random?
        # Random data usually has no clusters.
        # If all are -1, that's also success.
        print("WARNING: No -1 found. This might be due to random data actually clustering, or the fix failed.")
        print(f"Topic counts: {pd.Series(topics).value_counts()}")

except Exception as e:
    print(f"FAILED with error: {e}")
