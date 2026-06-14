Prepared split network data is stored in the repository-root `data/` folder.

GitHub Pages can fetch these files directly because they are normal JSON files,
not Git LFS pointers. The static preview loads the overview files first:

- `data/citation_network_top500.json`
- `data/author_collaboration_network_top1000.json`

The "Load More Data" buttons then read the part files listed in:

- `data/citation_network_manifest.json`
- `data/author_collaboration_network_manifest.json`

To regenerate split files:

```powershell
python scripts/split_network_json.py paper_citation_network_2019_2024.json --output-dir data --prefix citation_network --top-n 500 --max-mb 24
python scripts/split_network_json.py uw_madison_5yr_author_collaboration_no_huge_papers.json --output-dir data --prefix author_collaboration_network --top-n 1000 --max-mb 24
```
