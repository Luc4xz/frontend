import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3';

export type RawRecord = Record<string, string | number | string[] | number[] | null | undefined>;

export interface PaperNode extends SimulationNodeDatum {
  id: string;
  title?: string;
  year?: number;
  citationCount: number;
  referenceCount?: number;
  patentCount?: number;
  totalDegree?: number;
  inDegree?: number;
  outDegree?: number;
  doctype?: string;
  topic?: string;
  cluster?: string;
  raw: RawRecord;
}

export interface GraphLink extends SimulationLinkDatum<PaperNode> {
  source: string | PaperNode;
  target: string | PaperNode;
  weight?: number;
  raw: RawRecord;
}

export interface AuthorNode extends SimulationNodeDatum {
  id: string;
  name: string;
  paperCount: number;
  collaborationCount?: number;
  institution?: string;
  cluster?: string;
  raw: RawRecord;
}

export interface AuthorLink extends SimulationLinkDatum<AuthorNode> {
  source: string | AuthorNode;
  target: string | AuthorNode;
  weight?: number;
  raw: RawRecord;
}

export interface YearCount {
  year: number;
  count: number;
  raw: RawRecord;
}

export interface PaperMetadata {
  id?: string;
  title?: string;
  year?: number;
  patentCount: number;
  paperCount?: number;
  raw: RawRecord;
}
