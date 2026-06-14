Raw source data should go in `public/data/raw/`.

Do not load raw CSV, JSON, or Parquet files directly in the frontend. Run the preprocessing script first:

```powershell
python scripts/preprocess_data.py --input public/data/raw --output public/data/processed
```

By default, preprocessing writes all available nodes, links, and metadata records. Pass `--limit N` only when you intentionally want a smaller preview subset.

The React/D3 frontend reads only these prepared files:

- `public/data/processed/paper_citation_network_top.json`
- `public/data/processed/author_collaboration_network_top.json` when author data exists
- `public/data/processed/paper_growth_timeline.json`
- `public/data/processed/patent_citation_records.json`
- `public/data/processed/manifest.json`

Expected raw paper citation inputs:

- `paper_citation_nodes_2020_2026.csv`
- `paper_citation_edges_2020_2026.csv`
- or `paper_citation_network_2020_2026.json`

Expected raw dashboard inputs:

- `uw_madison_cs_papers_10yr.csv`
- `uw_madison_cs_papers_5yr.csv`
- `uw_madison_cs_paper_ids.csv`

Optional raw author collaboration inputs:

- `author_collaboration_network_2020_2026.json`
- `author_collaboration_nodes_2020_2026.csv`
- `author_collaboration_edges_2020_2026.csv`
