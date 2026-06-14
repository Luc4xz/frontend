import * as d3 from 'd3';
import type { AuthorLink, AuthorNode, GraphLink, PaperMetadata, PaperNode, YearCount } from '../types/data';

const processedPath = (fileName: string) => `data/processed/${fileName}`;

async function loadJson<T>(fileName: string): Promise<T> {
  const payload = await d3.json(processedPath(fileName));
  if (!payload) throw new Error(`Missing processed JSON file: ${fileName}`);
  return payload as T;
}

export async function loadPaperCitationGraph(): Promise<{ nodes: PaperNode[]; links: GraphLink[] }> {
  try {
    const graph = await d3.json<{
      nodes?: Array<Record<string, string | number | null | undefined>>;
      links?: Array<Record<string, string | number | null | undefined>>;
      edges?: Array<Record<string, string | number | null | undefined>>;
    }>('paper_citation_network_2019_2024.json');
    if (graph?.nodes?.length) {
      const nodes = graph.nodes.map((node, index) => {
        const id = String(node.id ?? `paper-${index + 1}`);
        const year = Number(node.year);
        const citationCount = Number(node.citationCount ?? node.citation_count ?? 0);
        const referenceCount = Number(node.referenceCount ?? node.reference_count ?? 0);
        const patentCount = Number(node.patentCount ?? node.patent_count ?? 0);
        const totalDegree = Number(node.totalDegree ?? node.total_degree ?? 0);
        const doctype = String(node.doctype ?? node.type ?? 'unknown');
        return {
          id,
          title: String(node.title ?? id),
          year: Number.isFinite(year) ? year : undefined,
          citationCount,
          referenceCount,
          patentCount,
          totalDegree,
          inDegree: Number(node.inDegree ?? node.in_degree ?? 0),
          outDegree: Number(node.outDegree ?? node.out_degree ?? 0),
          doctype,
          topic: doctype,
          cluster: doctype,
          raw: node
        };
      });
      const links = (graph.links ?? graph.edges ?? [])
        .map((link) => ({
          source: String(link.source ?? ''),
          target: String(link.target ?? ''),
          weight: Number(link.weight ?? 1),
          raw: link
        }))
        .filter((link) => link.source && link.target);
      return { nodes, links };
    }
  } catch {
    // Fall back to the generated processed JSON used by the smaller default workflow.
  }

  return loadJson<{ nodes: PaperNode[]; links: GraphLink[] }>('paper_citation_network_top.json');
}

export async function loadAuthorCollaborationGraph(): Promise<{ nodes: AuthorNode[]; links: AuthorLink[] } | null> {
  try {
    const graph = await d3.json<{
      nodes?: Array<Record<string, string | number | string[] | number[] | null | undefined>>;
      links?: Array<Record<string, string | number | string[] | number[] | null | undefined>>;
      edges?: Array<Record<string, string | number | string[] | number[] | null | undefined>>;
    }>('uw_madison_5yr_author_collaboration_network_web.json');
    if (graph?.nodes?.length) {
      const nodes = graph.nodes.map((node, index) => {
        const id = String(node.id ?? `author-${index + 1}`);
        return {
          id,
          name: String(node.name ?? id),
          paperCount: Number(node.paperCount ?? node.paper_count ?? 0),
          collaborationCount: Number(node.collaborationCount ?? node.collaborator_count ?? node.collaboration_count ?? 0),
          institution: typeof node.institution === 'string' ? node.institution : undefined,
          cluster: String(node.cluster ?? node.type ?? 'author'),
          raw: node
        };
      });
      const links = (graph.links ?? graph.edges ?? [])
        .map((link) => ({
          source: String(link.source ?? ''),
          target: String(link.target ?? ''),
          weight: Number(link.weight ?? link.shared_paper_count ?? 1),
          raw: link
        }))
        .filter((link) => link.source && link.target);
      return { nodes, links };
    }
  } catch {
    // Fall back to generated processed JSON if the root author network is absent.
  }

  try {
    return await loadJson<{ nodes: AuthorNode[]; links: AuthorLink[] }>('author_collaboration_network_top.json');
  } catch {
    return null;
  }
}

export async function loadPaperGrowth(): Promise<YearCount[]> {
  try {
    const dashboard = await d3.json<{
      timeline?: Array<{ year?: number; count?: number; paper_count?: number; paperCount?: number }>;
    }>('dashboard_data.json');
    if (dashboard?.timeline?.length) {
      return dashboard.timeline
        .map((row) => ({
          year: Number(row.year),
          count: Number(row.count ?? row.paper_count ?? row.paperCount ?? 0),
          raw: row
        }))
        .filter((row) => Number.isFinite(row.year) && row.year > 0)
        .sort((a, b) => a.year - b.year);
    }
  } catch {
    // Fall back to the separate root JSON file.
  }

  try {
    const growth = await d3.json<Array<{ year?: number; count?: number; paper_count?: number; paperCount?: number }>>('paper_growth_10yr.json');
    if (growth?.length) {
      return growth
        .map((row) => ({
          year: Number(row.year),
          count: Number(row.count ?? row.paper_count ?? row.paperCount ?? 0),
          raw: row
        }))
        .filter((row) => Number.isFinite(row.year) && row.year > 0)
        .sort((a, b) => a.year - b.year);
    }
  } catch {
    // Fall back to the generated processed JSON used by the normal workflow.
  }

  return loadJson<YearCount[]>('paper_growth_timeline.json');
}

export async function loadPaperMetadata(): Promise<PaperMetadata[]> {
  try {
    const yearlyDistribution = await d3.json<{
      patentHistogramByYear?: Record<string, Array<{ patent_count?: number; patentCount?: number; paper_count?: number; paperCount?: number }>>;
    }>('patent_histogram_by_year.json');
    if (yearlyDistribution?.patentHistogramByYear) {
      return Object.entries(yearlyDistribution.patentHistogramByYear).flatMap(([year, bins]) =>
        bins.map((bin) => ({
          year: Number(year),
          patentCount: Number(bin.patent_count ?? bin.patentCount ?? 0),
          paperCount: Number(bin.paper_count ?? bin.paperCount ?? 0),
          raw: bin
        }))
      );
    }
  } catch {
    // Fall back to dashboard_data.json.
  }

  try {
    const dashboard = await d3.json<{
      defaultPatentHistogram?: Array<{ patent_count?: number; patentCount?: number; paper_count?: number; paperCount?: number }>;
      patentHistogramByYear?: Record<string, Array<{ patent_count?: number; patentCount?: number; paper_count?: number; paperCount?: number }>>;
      patentHistogramsByYear?: Record<string, Array<{ patent_count?: number; patentCount?: number; paper_count?: number; paperCount?: number }>>;
      yearlyPatentHistograms?: Array<{ year?: number; histogram?: Array<{ patent_count?: number; patentCount?: number; paper_count?: number; paperCount?: number }> }>;
    }>('dashboard_data.json');
    const byYear = dashboard?.patentHistogramByYear ?? dashboard?.patentHistogramsByYear;
    if (byYear) {
      return Object.entries(byYear).flatMap(([year, bins]) =>
        bins.map((bin) => ({
          year: Number(year),
          patentCount: Number(bin.patent_count ?? bin.patentCount ?? 0),
          paperCount: Number(bin.paper_count ?? bin.paperCount ?? 0),
          raw: bin
        }))
      );
    }
    if (dashboard?.yearlyPatentHistograms?.length) {
      return dashboard.yearlyPatentHistograms.flatMap((entry) =>
        (entry.histogram ?? []).map((bin) => ({
          year: Number(entry.year),
          patentCount: Number(bin.patent_count ?? bin.patentCount ?? 0),
          paperCount: Number(bin.paper_count ?? bin.paperCount ?? 0),
          raw: bin
        }))
      );
    }
    if (dashboard?.defaultPatentHistogram?.length) {
      return dashboard.defaultPatentHistogram.map((bin) => ({
        patentCount: Number(bin.patent_count ?? bin.patentCount ?? 0),
        paperCount: Number(bin.paper_count ?? bin.paperCount ?? 0),
        raw: bin
      }));
    }
  } catch {
    // Fall back to the separate patent histogram file.
  }

  try {
    const distribution = await d3.json<{
      histogram?: Array<{ patent_count?: number; patentCount?: number; paper_count?: number; paperCount?: number }>;
      by_year?: Record<string, Array<{ patent_count?: number; patentCount?: number; paper_count?: number; paperCount?: number }>>;
      years?: Array<{ year?: number; histogram?: Array<{ patent_count?: number; patentCount?: number; paper_count?: number; paperCount?: number }> }>;
    }>('patent_count_distribution.json');
    if (distribution?.by_year) {
      return Object.entries(distribution.by_year).flatMap(([year, bins]) =>
        bins.map((bin) => ({
          year: Number(year),
          patentCount: Number(bin.patent_count ?? bin.patentCount ?? 0),
          paperCount: Number(bin.paper_count ?? bin.paperCount ?? 0),
          raw: bin
        }))
      );
    }
    if (distribution?.years?.length) {
      return distribution.years.flatMap((entry) =>
        (entry.histogram ?? []).map((bin) => ({
          year: Number(entry.year),
          patentCount: Number(bin.patent_count ?? bin.patentCount ?? 0),
          paperCount: Number(bin.paper_count ?? bin.paperCount ?? 0),
          raw: bin
        }))
      );
    }
    if (distribution?.histogram?.length) {
      return distribution.histogram.map((bin) => ({
        patentCount: Number(bin.patent_count ?? bin.patentCount ?? 0),
        paperCount: Number(bin.paper_count ?? bin.paperCount ?? 0),
        raw: bin
      }));
    }
  } catch {
    // Fall back to the generated processed JSON used by the normal workflow.
  }

  return loadJson<PaperMetadata[]>('patent_citation_records.json');
}
