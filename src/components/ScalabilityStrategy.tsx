export function ScalabilityStrategy() {
  return (
    <section className="strategy-panel">
      <h2>Scalability Strategy</h2>
      <p>
        To address scalability issues caused by the large dataset, this dashboard does not load the entire dataset directly into the frontend. Instead,
        the data is preprocessed into a smaller initial subset, such as the top 300-500 most significant records, for the first visualization. Significance
        can be determined by citation count, patent count, number of references, author influence, or network connectivity.
      </p>
      <p>
        The website uses progressive data loading. The first screen provides a high-level overview of the citation network or author collaboration
        network. When users interact with the visualization, such as clicking a node, selecting a year, or zooming into a cluster, the frontend can request
        more related data from a backend so the network expands dynamically based on user interest instead of overwhelming the browser at the start.
      </p>
      <p>
        This strategy improves loading speed, reduces memory pressure, and keeps the visualization readable. It also creates a better user experience
        because users can begin with a simplified overview and then explore more detailed relationships interactively.
      </p>
    </section>
  );
}
