from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


DEFAULT_INPUT = Path("public/data/raw")
DEFAULT_OUTPUT = Path("public/data/processed")

KEYS = {
    "paper_id": ["id", "paper_id", "paperid", "Paper_ID", "PaperId", "doi", "DOI"],
    "title": ["title", "paper_title", "Paper_Title", "name", "label"],
    "year": ["year", "publication_year", "pub_year", "Publication_Year", "Year"],
    "citations": ["citation_count", "citations", "Citation_Count", "cited_by_count", "Cited_By_Count", "num_citations"],
    "references": ["reference_count", "references", "Reference_Count", "ref_count", "Num_References"],
    "patents": ["Patent_Count", "patent_count", "patents", "patent_citations", "PatentCitationCount"],
    "topic": ["topic", "Topic", "field", "Field", "cluster", "Cluster", "community"],
    "source": ["source", "Source", "from", "citing_paper_id", "citing", "source_id"],
    "target": ["target", "Target", "to", "cited_paper_id", "cited", "target_id"],
    "weight": ["weight", "Weight", "count", "Count", "strength"],
    "author_id": ["author_id", "Author_ID", "id", "ID"],
    "author_name": ["author_name", "Author_Name", "name", "label"],
    "paper_count": ["paper_count", "Paper_Count", "papers", "num_papers"],
    "collaborations": ["collaboration_count", "Collaboration_Count", "degree", "coauthor_count"],
    "institution": ["institution", "Institution", "affiliation", "Affiliation"],
}


def read_csv(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def read_json(path: Path) -> Any:
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


def pick(row: dict[str, Any], keys: list[str], default: str = "") -> str:
    for key in keys:
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return default


def number(row: dict[str, Any], keys: list[str], default: float = 0) -> float:
    raw = pick(row, keys)
    try:
        return float(raw)
    except ValueError:
        return default


def clean_int(value: float | int | None) -> int:
    if value is None:
        return 0
    return int(value)


def normalize_paper_node(row: dict[str, Any], index: int) -> dict[str, Any]:
    paper_id = pick(row, KEYS["paper_id"], f"paper-{index + 1}")
    year = number(row, KEYS["year"], 0)
    citations = number(row, KEYS["citations"], 0)
    patents = number(row, KEYS["patents"], 0)
    references = number(row, KEYS["references"], 0)
    topic = pick(row, KEYS["topic"], "")
    return {
        "id": paper_id,
        "title": pick(row, KEYS["title"], paper_id),
        "year": clean_int(year) if year else None,
        "citationCount": clean_int(citations),
        "patentCount": clean_int(patents),
        "referenceCount": clean_int(references),
        "group": topic or (str(clean_int(year)) if year else "Unknown"),
        "importance": clean_int(citations * 3 + patents * 2 + references),
    }


def normalize_link(row: dict[str, Any]) -> dict[str, Any] | None:
    source = pick(row, KEYS["source"])
    target = pick(row, KEYS["target"])
    if not source or not target:
        return None
    return {
        "source": source,
        "target": target,
        "weight": max(1, clean_int(number(row, KEYS["weight"], 1))),
    }


def load_paper_graph(input_dir: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    node_rows = read_csv(input_dir / "paper_citation_nodes_2020_2026.csv")
    edge_rows = read_csv(input_dir / "paper_citation_edges_2020_2026.csv")
    if node_rows:
        return [normalize_paper_node(row, index) for index, row in enumerate(node_rows)], [link for row in edge_rows if (link := normalize_link(row))]

    graph = read_json(input_dir / "paper_citation_network_2020_2026.json") or {}
    raw_nodes = graph.get("nodes", [])
    raw_links = graph.get("links", graph.get("edges", []))
    return [normalize_paper_node(row, index) for index, row in enumerate(raw_nodes)], [link for row in raw_links if (link := normalize_link(row))]


def top_connected_subset(nodes: list[dict[str, Any]], links: list[dict[str, Any]], limit: int | None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    degree = Counter()
    for link in links:
        degree[link["source"]] += 1
        degree[link["target"]] += 1

    ranked = sorted(
        nodes,
        key=lambda node: (
            node.get("importance", 0),
            degree[node["id"]],
            node.get("citationCount", 0),
            node.get("patentCount", 0),
        ),
        reverse=True,
    )
    if limit and limit > 0:
        ranked = ranked[:limit]
    kept = {node["id"] for node in ranked}
    return ranked, [link for link in links if link["source"] in kept and link["target"] in kept]


def build_timeline(rows: list[dict[str, Any]]) -> list[dict[str, int]]:
    count_keys = ["paper_count", "Paper_Count", "count", "Count", "papers", "num_papers"]
    if rows and any(key in rows[0] for key in count_keys):
        timeline = [
            {"year": clean_int(number(row, KEYS["year"], 0)), "count": clean_int(number(row, count_keys, 0))}
            for row in rows
        ]
    else:
        counts = Counter(clean_int(number(row, KEYS["year"], 0)) for row in rows)
        timeline = [{"year": year, "count": count} for year, count in counts.items() if year]
    return sorted((row for row in timeline if row["year"]), key=lambda row: row["year"])


def build_patent_records(rows: list[dict[str, Any]], limit: int | None) -> list[dict[str, Any]]:
    records = [
        {
            "id": pick(row, KEYS["paper_id"], f"paper-{index + 1}"),
            "year": clean_int(number(row, KEYS["year"], 0)) or None,
            "patentCount": clean_int(number(row, KEYS["patents"], 0)),
            "citationCount": clean_int(number(row, KEYS["citations"], 0)),
        }
        for index, row in enumerate(rows)
    ]
    sorted_records = sorted(records, key=lambda row: (row["patentCount"], row["citationCount"]), reverse=True)
    return sorted_records[:limit] if limit and limit > 0 else sorted_records


def normalize_author_node(row: dict[str, Any], index: int) -> dict[str, Any]:
    author_id = pick(row, KEYS["author_id"], pick(row, KEYS["author_name"], f"author-{index + 1}"))
    papers = clean_int(number(row, KEYS["paper_count"], 0))
    collaborations = clean_int(number(row, KEYS["collaborations"], 0))
    group = pick(row, KEYS["topic"], pick(row, KEYS["institution"], "Unknown"))
    return {
        "id": author_id,
        "name": pick(row, KEYS["author_name"], author_id),
        "paperCount": papers,
        "collaborationCount": collaborations,
        "institution": pick(row, KEYS["institution"], ""),
        "group": group,
        "importance": papers * 3 + collaborations,
    }


def load_author_graph(input_dir: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]] | None:
    json_names = ["author_collaboration_network_2020_2026.json", "author_collaboration_network.json", "author_network_2020_2026.json"]
    for name in json_names:
        graph = read_json(input_dir / name)
        if graph and graph.get("nodes"):
            nodes = [normalize_author_node(row, index) for index, row in enumerate(graph.get("nodes", []))]
            links = [link for row in graph.get("links", graph.get("edges", [])) if (link := normalize_link(row))]
            return nodes, links

    csv_pairs = [
        ("author_collaboration_nodes_2020_2026.csv", "author_collaboration_edges_2020_2026.csv"),
        ("author_nodes_2020_2026.csv", "author_edges_2020_2026.csv"),
        ("author_collaboration_nodes.csv", "author_collaboration_edges.csv"),
    ]
    for nodes_name, edges_name in csv_pairs:
        node_rows = read_csv(input_dir / nodes_name)
        edge_rows = read_csv(input_dir / edges_name)
        if node_rows:
            return [normalize_author_node(row, index) for index, row in enumerate(node_rows)], [link for row in edge_rows if (link := normalize_link(row))]
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Preprocess large academic datasets into small JSON files for the D3 frontend.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="Folder containing raw CSV/JSON files.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Folder where processed JSON files are written.")
    parser.add_argument("--limit", type=int, default=0, help="Maximum nodes/records for initial visualization JSON. Use 0 to include all records.")
    args = parser.parse_args()

    paper_nodes, paper_links = load_paper_graph(args.input)
    paper_subset, paper_subset_links = top_connected_subset(paper_nodes, paper_links, args.limit)
    write_json(args.output / "paper_citation_network_top.json", {"nodes": paper_subset, "links": paper_subset_links})

    growth_rows = read_csv(args.input / "uw_madison_cs_papers_10yr.csv")
    write_json(args.output / "paper_growth_timeline.json", build_timeline(growth_rows) if growth_rows else [])

    metadata_rows = read_csv(args.input / "uw_madison_cs_papers_5yr.csv") or read_csv(args.input / "paper_citation_nodes_2020_2026.csv") or growth_rows
    patent_limit = args.limit * 4 if args.limit and args.limit > 0 else None
    write_json(args.output / "patent_citation_records.json", build_patent_records(metadata_rows, patent_limit) if metadata_rows else [])

    author_graph = load_author_graph(args.input)
    if author_graph:
        author_nodes, author_links = author_graph
        author_subset, author_subset_links = top_connected_subset(author_nodes, author_links, args.limit)
        write_json(args.output / "author_collaboration_network_top.json", {"nodes": author_subset, "links": author_subset_links})

    manifest = {
        "nodeLimit": args.limit if args.limit and args.limit > 0 else None,
        "paperNodes": len(paper_subset),
        "paperLinks": len(paper_subset_links),
        "authorDataAvailable": author_graph is not None,
        "sourceFolder": str(args.input),
    }
    write_json(args.output / "manifest.json", manifest)
    print(f"Wrote processed frontend JSON files to {args.output}")


if __name__ == "__main__":
    main()
