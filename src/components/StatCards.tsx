interface StatCardsProps {
  paperCount: number;
  citationLinks: number;
  authorCount: number;
  collaborationLinks: number;
}

function formatCount(value: number) {
  return value > 0 ? value.toLocaleString() : 'Not loaded';
}

export function StatCards({ paperCount, citationLinks, authorCount, collaborationLinks }: StatCardsProps) {
  return (
    <section className="stat-grid" aria-label="Summary statistics">
      <article className="stat-card">
        <span className="stat-label">Paper Nodes</span>
        <strong>{formatCount(paperCount)}</strong>
        <span className="stat-note">Citation-network papers loaded from local data</span>
      </article>
      <article className="stat-card">
        <span className="stat-label">Citation Edges</span>
        <strong>{formatCount(citationLinks)}</strong>
        <span className="stat-note">Paper-to-paper citation relationships</span>
      </article>
      <article className="stat-card">
        <span className="stat-label">Author Nodes</span>
        <strong>{formatCount(authorCount)}</strong>
        <span className="stat-note">Author collaboration records when available</span>
      </article>
      <article className="stat-card">
        <span className="stat-label">Collaboration Edges</span>
        <strong>{formatCount(collaborationLinks)}</strong>
        <span className="stat-note">Co-authorship links when available</span>
      </article>
    </section>
  );
}
