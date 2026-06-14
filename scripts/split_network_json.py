"""Split a network JSON file into GitHub Pages-friendly JSON files.

The splitter keeps each output file as a valid graph with its own node list and
only links whose endpoints are present in that file. It writes a small overview
graph first, then link-based part files that can be loaded progressively.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def compact_bytes(data: Any) -> bytes:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def write_json(path: Path, data: Any) -> int:
    payload = compact_bytes(data)
    path.write_bytes(payload)
    return len(payload)


def node_id(node: dict[str, Any]) -> str:
    return str(node.get("id", ""))


def link_endpoint(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("id", ""))
    return str(value)


def node_score(node: dict[str, Any], degree: dict[str, int]) -> float:
    nid = node_id(node)
    return (
        degree.get(nid, 0) * 8
        + float(node.get("totalDegree") or node.get("total_degree") or 0) * 6
        + float(node.get("citationCount") or node.get("citation_count") or 0) * 3
        + float(node.get("paperCount") or node.get("paper_count") or 0) * 3
        + float(node.get("collaborationCount") or node.get("collaborator_count") or node.get("collaboration_count") or 0) * 2
        + float(node.get("patentCount") or node.get("patent_count") or 0)
    )


def graph_size_from_parts(node_bytes: int, node_count: int, link_bytes: int, link_count: int) -> int:
    return (
        len('{"nodes":[')
        + node_bytes
        + max(0, node_count - 1)
        + len('],"links":[')
        + link_bytes
        + max(0, link_count - 1)
        + len("]}")
    )


def split_network(input_path: Path, output_dir: Path, prefix: str, top_n: int, max_mb: float) -> None:
    raw = input_path.read_text(encoding="utf-8")
    if raw.startswith("version https://git-lfs.github.com/spec/v1"):
        raise SystemExit(f"{input_path} is a Git LFS pointer, not JSON. Restore the real file first.")

    graph = json.loads(raw)
    nodes = graph.get("nodes", [])
    links = graph.get("links", graph.get("edges", []))
    if not isinstance(nodes, list) or not isinstance(links, list):
        raise SystemExit("Expected network JSON with list fields: nodes and links/edges.")

    output_dir.mkdir(parents=True, exist_ok=True)
    for old_file in output_dir.glob(f"{prefix}_*.json"):
        old_file.unlink()

    node_by_id = {node_id(node): node for node in nodes if node_id(node)}
    node_byte_size = {nid: len(compact_bytes(node)) for nid, node in node_by_id.items()}
    valid_links: list[dict[str, Any]] = []
    degree: dict[str, int] = {}
    for link in links:
        source = link_endpoint(link.get("source"))
        target = link_endpoint(link.get("target"))
        if source in node_by_id and target in node_by_id:
            normalized = dict(link)
            normalized["source"] = source
            normalized["target"] = target
            valid_links.append(normalized)
            degree[source] = degree.get(source, 0) + 1
            degree[target] = degree.get(target, 0) + 1

    ranked_nodes = sorted(node_by_id.values(), key=lambda node: node_score(node, degree), reverse=True)
    overview_nodes = ranked_nodes[: min(top_n, len(ranked_nodes))]
    overview_ids = {node_id(node) for node in overview_nodes}
    overview_links = [link for link in valid_links if link["source"] in overview_ids and link["target"] in overview_ids]
    overview_name = f"{prefix}_top{len(overview_nodes)}.json"
    overview_size = write_json(output_dir / overview_name, {"nodes": overview_nodes, "links": overview_links})

    max_bytes = int(max_mb * 1024 * 1024)
    part_files: list[dict[str, Any]] = []
    current_links: list[dict[str, Any]] = []
    current_ids: set[str] = set()
    current_node_bytes = 0
    current_link_bytes = 0
    part_index = 1

    sorted_links = sorted(
        valid_links,
        key=lambda link: (
            -float(link.get("weight") or link.get("shared_paper_count") or 1),
            link["source"],
            link["target"],
        ),
    )

    def flush_part() -> None:
        nonlocal current_links, current_ids, current_node_bytes, current_link_bytes, part_index
        if not current_links:
            return
        part_nodes = [node_by_id[nid] for nid in sorted(current_ids) if nid in node_by_id]
        name = f"{prefix}_part_{part_index}.json"
        size = write_json(output_dir / name, {"nodes": part_nodes, "links": current_links})
        if size > max_bytes:
            raise SystemExit(f"{name} is {size / 1024 / 1024:.2f} MB, above limit. Lower --max-mb or inspect huge links.")
        part_files.append({"file": name, "nodes": len(part_nodes), "links": len(current_links), "bytes": size})
        part_index += 1
        current_links = []
        current_ids = set()
        current_node_bytes = 0
        current_link_bytes = 0

    for link in sorted_links:
        new_ids = [nid for nid in (link["source"], link["target"]) if nid not in current_ids]
        link_size = len(compact_bytes(link))
        candidate_node_bytes = current_node_bytes + sum(node_byte_size[nid] for nid in new_ids)
        candidate_node_count = len(current_ids) + len(new_ids)
        candidate_link_bytes = current_link_bytes + link_size
        candidate_link_count = len(current_links) + 1
        candidate_size = graph_size_from_parts(candidate_node_bytes, candidate_node_count, candidate_link_bytes, candidate_link_count)
        if current_links and candidate_size > max_bytes:
            flush_part()
            new_ids = [nid for nid in (link["source"], link["target"]) if nid not in current_ids]
            candidate_node_bytes = current_node_bytes + sum(node_byte_size[nid] for nid in new_ids)
            candidate_node_count = len(current_ids) + len(new_ids)
            candidate_size = graph_size_from_parts(candidate_node_bytes, candidate_node_count, link_size, 1)
            if candidate_size > max_bytes:
                raise SystemExit(f"A single link plus its endpoint nodes is {candidate_size / 1024 / 1024:.2f} MB, above limit.")
        current_links.append(link)
        current_link_bytes += link_size
        current_ids.update([link["source"], link["target"]])
        current_node_bytes += sum(node_byte_size[nid] for nid in new_ids)
    flush_part()

    linked_ids = {endpoint for link in valid_links for endpoint in (link["source"], link["target"])}
    isolated_nodes = [node for node in node_by_id.values() if node_id(node) not in linked_ids]
    isolated_file = None
    if isolated_nodes:
        isolated_file = f"{prefix}_isolated_nodes.json"
        isolated_size = write_json(output_dir / isolated_file, {"nodes": isolated_nodes, "links": []})
        if isolated_size > max_bytes:
            raise SystemExit(f"{isolated_file} is {isolated_size / 1024 / 1024:.2f} MB, above limit.")

    manifest = {
        "source": input_path.name,
        "overview": overview_name,
        "parts": [entry["file"] for entry in part_files],
        "isolated": isolated_file,
        "nodeCount": len(node_by_id),
        "linkCount": len(valid_links),
        "overviewNodeCount": len(overview_nodes),
        "overviewLinkCount": len(overview_links),
        "maxPartMB": max_mb,
        "files": [{"file": overview_name, "nodes": len(overview_nodes), "links": len(overview_links), "bytes": overview_size}] + part_files,
    }
    if isolated_file:
        manifest["files"].append({"file": isolated_file, "nodes": len(isolated_nodes), "links": 0, "bytes": isolated_size})
    write_json(output_dir / f"{prefix}_manifest.json", manifest)

    print(f"Wrote {overview_name} and {len(part_files)} part file(s) to {output_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Split network JSON into overview and progressive part files under a size limit.")
    parser.add_argument("input", type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path("data"))
    parser.add_argument("--prefix", required=True)
    parser.add_argument("--top-n", type=int, default=500)
    parser.add_argument("--max-mb", type=float, default=24)
    args = parser.parse_args()
    split_network(args.input, args.output_dir, args.prefix, args.top_n, args.max_mb)


if __name__ == "__main__":
    main()
