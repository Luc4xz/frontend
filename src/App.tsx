import { useCallback, useEffect, useState } from 'react';
import { AuthorCollaborationNetwork } from './components/AuthorCollaborationNetwork';
import { Header } from './components/Header';
import { PaperCitationNetwork } from './components/PaperCitationNetwork';
import { PaperGrowthTimeline } from './components/PaperGrowthTimeline';
import { PatentCitationHistogram } from './components/PatentCitationHistogram';
import { ScalabilityStrategy } from './components/ScalabilityStrategy';
import { StatCards } from './components/StatCards';
import { loadAuthorCollaborationGraph, loadPaperCitationGraph, loadPaperGrowth, loadPaperMetadata } from './utils/dataLoaders';
import type { AuthorLink, AuthorNode, GraphLink, PaperMetadata, PaperNode, YearCount } from './types/data';

function App() {
  const [paperNodes, setPaperNodes] = useState<PaperNode[]>([]);
  const [paperLinks, setPaperLinks] = useState<GraphLink[]>([]);
  const [authorNodes, setAuthorNodes] = useState<AuthorNode[]>([]);
  const [authorLinks, setAuthorLinks] = useState<AuthorLink[]>([]);
  const [growthData, setGrowthData] = useState<YearCount[]>([]);
  const [paperMetadata, setPaperMetadata] = useState<PaperMetadata[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const [paperLoading, setPaperLoading] = useState(true);
  const [authorLoading, setAuthorLoading] = useState(true);
  const [growthLoading, setGrowthLoading] = useState(true);
  const [metadataLoading, setMetadataLoading] = useState(true);

  const [paperError, setPaperError] = useState<string>();
  const [authorError, setAuthorError] = useState<string>();
  const [growthError, setGrowthError] = useState<string>();
  const [metadataError, setMetadataError] = useState<string>();
  const [authorMissing, setAuthorMissing] = useState(false);

  useEffect(() => {
    let active = true;

    loadPaperCitationGraph()
      .then((graph) => {
        if (!active) return;
        setPaperNodes(graph.nodes);
        setPaperLinks(graph.links);
      })
      .catch(() => {
        if (active) setPaperError('Prepared paper citation JSON could not be loaded. Run scripts/preprocess_data.py to create public/data/processed/paper_citation_network_top.json.');
      })
      .finally(() => {
        if (active) setPaperLoading(false);
      });

    loadAuthorCollaborationGraph()
      .then((graph) => {
        if (!active) return;
        if (!graph) {
          setAuthorMissing(true);
          return;
        }
        setAuthorNodes(graph.nodes);
        setAuthorLinks(graph.links);
      })
      .catch(() => {
        if (active) setAuthorError('Author collaboration data could not be parsed.');
      })
      .finally(() => {
        if (active) setAuthorLoading(false);
      });

    loadPaperGrowth()
      .then((data) => {
        if (active) setGrowthData(data);
      })
      .catch(() => {
        if (active) setGrowthError('Prepared paper growth JSON could not be loaded. Run scripts/preprocess_data.py to create public/data/processed/paper_growth_timeline.json.');
      })
      .finally(() => {
        if (active) setGrowthLoading(false);
      });

    loadPaperMetadata()
      .then((data) => {
        if (active) setPaperMetadata(data);
      })
      .catch(() => {
        if (active) setMetadataError('Prepared patent citation JSON could not be loaded. Run scripts/preprocess_data.py to create public/data/processed/patent_citation_records.json.');
      })
      .finally(() => {
        if (active) setMetadataLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const handleSelectYear = useCallback((year: number) => setSelectedYear(year), []);
  const handleResetYear = useCallback(() => setSelectedYear(null), []);

  return (
    <div className="app-shell">
      <Header />
      <StatCards
        paperCount={paperNodes.length}
        citationLinks={paperLinks.length}
        authorCount={authorNodes.length}
        collaborationLinks={authorLinks.length}
      />

      <main className="dashboard-layout">
        <PaperCitationNetwork nodes={paperNodes} links={paperLinks} loading={paperLoading} error={paperError} />
        <AuthorCollaborationNetwork
          nodes={authorNodes}
          links={authorLinks}
          loading={authorLoading}
          missing={authorMissing}
          error={authorError}
        />
        <section className="paired-dashboard">
          <PaperGrowthTimeline
            data={growthData}
            selectedYear={selectedYear}
            onSelectYear={handleSelectYear}
            loading={growthLoading}
            error={growthError}
          />
          <PatentCitationHistogram
            papers={paperMetadata}
            selectedYear={selectedYear}
            onResetYear={handleResetYear}
            loading={metadataLoading}
            error={metadataError}
          />
        </section>
      </main>

      <ScalabilityStrategy />
    </div>
  );
}

export default App;
