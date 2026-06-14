import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { PaperMetadata } from '../types/data';

interface PatentCitationHistogramProps {
  papers: PaperMetadata[];
  selectedYear: number | null;
  onResetYear: () => void;
  loading: boolean;
  error?: string;
}

interface DetailCard {
  title: string;
  body: string;
}

interface FloatingTooltip {
  title: string;
  lines: string[];
  x: number;
  y: number;
  visible: boolean;
}

export function PatentCitationHistogram({ papers, selectedYear, onResetYear, loading, error }: PatentCitationHistogramProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [barDetail, setBarDetail] = useState<DetailCard | null>(null);
  const [tooltip, setTooltip] = useState<FloatingTooltip | null>(null);
  const tooltipTimerRef = useRef<number | null>(null);
  const [resizeTick, setResizeTick] = useState(0);
  const isAggregatedDistribution = useMemo(() => papers.some((paper) => typeof paper.paperCount === 'number'), [papers]);
  const hasYearSpecificDistribution = useMemo(() => papers.some((paper) => Number.isFinite(paper.year)), [papers]);
  const filtered = useMemo(() => {
    if (selectedYear !== null) {
      return hasYearSpecificDistribution ? papers.filter((paper) => paper.year === selectedYear) : [];
    }
    if (isAggregatedDistribution && hasYearSpecificDistribution) {
      const byPatentCount = d3.rollups(
        papers,
        (records) => d3.sum(records, (record) => record.paperCount ?? 0),
        (record) => record.patentCount
      );
      return byPatentCount
        .map(([patentCount, paperCount]) => ({ patentCount, paperCount, raw: { patentCount, paperCount } }))
        .sort((a, b) => a.patentCount - b.patentCount);
    }
    return papers;
  }, [hasYearSpecificDistribution, isAggregatedDistribution, papers, selectedYear]);

  const overview = useMemo(() => {
    if (!filtered.length) return null;
    if (isAggregatedDistribution) {
      const totalPapers = d3.sum(filtered, (paper) => paper.paperCount ?? 0);
      const totalPatentCitations = d3.sum(filtered, (paper) => paper.patentCount * (paper.paperCount ?? 0));
      const averagePatentCitations = totalPapers > 0 ? totalPatentCitations / totalPapers : 0;
      const mostCommon = filtered.reduce((best, paper) => {
        if (!best || (paper.paperCount ?? 0) > (best.paperCount ?? 0)) return paper;
        return best;
      }, undefined as PaperMetadata | undefined);
      return {
        title: `${totalPapers.toLocaleString()} papers in this distribution`,
        body: `Average patent citations: ${averagePatentCitations.toFixed(2)}. Most common bin: ${mostCommon?.patentCount ?? 0} patent citations.`
      };
    }

    const averagePatentCitations = d3.mean(filtered, (paper) => paper.patentCount) ?? 0;
    const maxPatentCitations = d3.max(filtered, (paper) => paper.patentCount) ?? 0;
    return {
      title: `${filtered.length.toLocaleString()} papers in this distribution`,
      body: `Average patent citations: ${averagePatentCitations.toFixed(2)}. Highest patent citation count: ${maxPatentCitations.toLocaleString()}.`
    };
  }, [filtered, isAggregatedDistribution]);

  function describeAggregatedBar(label: string, count: number) {
    const totalPapers = d3.sum(filtered, (paper) => paper.paperCount ?? 0);
    const share = totalPapers > 0 ? (count / totalPapers) * 100 : 0;
    setBarDetail({
      title: `${label}: ${count.toLocaleString()} papers`,
      body: `${share.toFixed(1)}% of papers in the displayed distribution.`
    });
  }

  function describeHistogramBar(label: string, count: number) {
    const share = filtered.length > 0 ? (count / filtered.length) * 100 : 0;
    setBarDetail({
      title: `${label}: ${count.toLocaleString()} papers`,
      body: `${share.toFixed(1)}% of papers in the displayed distribution.`
    });
  }

  useEffect(() => {
    const onResize = () => setResizeTick((tick) => tick + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current !== null) window.clearTimeout(tooltipTimerRef.current);
    };
  }, []);

  function showTooltip(event: MouseEvent, title: string, lines: string[]) {
    if (tooltipTimerRef.current !== null) window.clearTimeout(tooltipTimerRef.current);
    setTooltip({ title, lines, x: event.clientX, y: event.clientY, visible: true });
  }

  function fadeTooltip() {
    setTooltip((current) => current ? { ...current, visible: false } : current);
    if (tooltipTimerRef.current !== null) window.clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = window.setTimeout(() => setTooltip(null), 1800);
  }

  useEffect(() => {
    const svgElement = svgRef.current;
    const wrapper = wrapperRef.current;
    if (!svgElement || !wrapper || !filtered.length) return;

    const width = Math.max(wrapper.clientWidth, 520);
    const height = 330;
    const margin = { top: 30, right: 28, bottom: 52, left: 62 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const svg = d3.select(svgElement);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const aggregatedAxisCap = 8;
    const aggregatedCounts = new Map(filtered.map((paper) => [paper.patentCount, paper.paperCount ?? 0]));
    const maxAggregatedValue = d3.max(filtered, (paper) => paper.patentCount) ?? 0;
    const aggregatedCategories = Array.from({ length: Math.min(aggregatedAxisCap, maxAggregatedValue) + 1 }, (_, patentCount) => ({
      key: String(patentCount),
      count: aggregatedCounts.get(patentCount) ?? 0,
      label: `${patentCount} patent citations`
    }));
    const tailCount = filtered
      .filter((paper) => paper.patentCount > aggregatedAxisCap)
      .reduce((sum, paper) => sum + (paper.paperCount ?? 0), 0);
    if (isAggregatedDistribution && tailCount > 0) {
      aggregatedCategories.push({
        key: `${aggregatedAxisCap + 1}+`,
        count: tailCount,
        label: `${aggregatedAxisCap + 1}+ patent citations`
      });
    }

    const bars = d3.bin()
          .domain([0, d3.max(filtered, (paper) => paper.patentCount) || 1])
          .thresholds(Math.min(18, Math.max(6, Math.ceil(Math.sqrt(filtered.length)))))
          (filtered.map((paper) => Math.max(0, paper.patentCount)))
          .map((bin) => ({
            x0: bin.x0 ?? 0,
            x1: bin.x1 ?? 0,
            count: bin.length,
            label: `${bin.x0 ?? 0}-${bin.x1 ?? 0} patent citations`
          }));
    const chart = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const defs = svg.append('defs');
    const barGradient = defs.append('linearGradient').attr('id', 'patent-bar-gradient').attr('x1', '0').attr('x2', '0').attr('y1', '0').attr('y2', '1');
    barGradient.append('stop').attr('offset', '0%').attr('stop-color', '#22d3ee');
    barGradient.append('stop').attr('offset', '100%').attr('stop-color', '#0f766e');
    const upperBarGradient = defs.append('linearGradient').attr('id', 'patent-upper-bar-gradient').attr('x1', '0').attr('x2', '0').attr('y1', '0').attr('y2', '1');
    upperBarGradient.append('stop').attr('offset', '0%').attr('stop-color', '#38bdf8');
    upperBarGradient.append('stop').attr('offset', '100%').attr('stop-color', '#0f766e');

    if (isAggregatedDistribution) {
      const x = d3.scaleBand().domain(aggregatedCategories.map((bar) => bar.key)).range([0, innerWidth]).padding(0.28);
      const maxCount = d3.max(aggregatedCategories, (bar) => bar.count) || 1;
      const secondLargestCount = d3.max(aggregatedCategories.filter((bar) => bar.count < maxCount), (bar) => bar.count) || 1;
      const useBrokenAxis = maxCount > secondLargestCount * 6;
      const topHeight = useBrokenAxis ? 56 : 0;
      const breakGap = useBrokenAxis ? 28 : 0;
      const lowerTop = topHeight + breakGap;
      const lowerHeight = innerHeight - lowerTop;
      const lowerMax = useBrokenAxis ? secondLargestCount * 1.18 : maxCount * 1.08;
      const lowerY = d3.scaleLinear().domain([0, lowerMax]).nice().range([lowerHeight, 0]);
      const topY = d3.scaleLinear()
        .domain([Math.max(lowerMax, Math.floor(maxCount / 1000) * 1000 - 1000), Math.ceil(maxCount / 1000) * 1000])
        .range([topHeight, 0]);

      if (useBrokenAxis) {
        chart.append('g').attr('class', 'chart-grid').attr('transform', `translate(0,${lowerTop})`).call(d3.axisLeft(lowerY).ticks(4).tickSize(-innerWidth).tickFormat(() => ''));
        chart.append('g').attr('class', 'chart-axis').call(d3.axisLeft(topY).ticks(2).tickFormat((d) => d3.format('~s')(Number(d))));
        chart.append('g').attr('class', 'chart-axis').attr('transform', `translate(0,${lowerTop})`).call(d3.axisLeft(lowerY).ticks(4).tickFormat((d) => d3.format('~s')(Number(d))));
        chart.append('rect')
          .attr('x', -8)
          .attr('y', topHeight + 4)
          .attr('width', innerWidth + 16)
          .attr('height', breakGap - 8)
          .attr('rx', 10)
          .attr('fill', '#ffffff')
          .attr('opacity', 0.9);
        chart.append('line')
          .attr('x1', 0)
          .attr('x2', innerWidth)
          .attr('y1', topHeight + 8)
          .attr('y2', topHeight + 8)
          .attr('stroke', '#dbeafe')
          .attr('stroke-dasharray', '2 8');
        chart.append('line')
          .attr('x1', 0)
          .attr('x2', innerWidth)
          .attr('y1', lowerTop - 8)
          .attr('y2', lowerTop - 8)
          .attr('stroke', '#dbeafe')
          .attr('stroke-dasharray', '2 8');
        chart.append('g')
          .attr('class', 'axis-break-glyph')
          .selectAll('line')
          .data([-8, 4])
          .join('line')
          .attr('x1', (d) => d)
          .attr('x2', (d) => d + 10)
          .attr('y1', topHeight + 22)
          .attr('y2', topHeight + 12)
          .attr('stroke', '#38bdf8')
          .attr('stroke-width', 1.7)
          .attr('stroke-linecap', 'round');
        chart.append('text')
          .attr('x', innerWidth)
          .attr('y', topHeight + 23)
          .attr('text-anchor', 'end')
          .attr('fill', '#64748b')
          .attr('font-size', 11)
          .attr('font-weight', 650)
          .text('axis break');
      } else {
        chart.append('g').attr('class', 'chart-grid').call(d3.axisLeft(lowerY).ticks(5).tickSize(-innerWidth).tickFormat(() => ''));
        chart.append('g').attr('class', 'chart-axis').call(d3.axisLeft(lowerY).ticks(5).tickFormat((d) => d3.format('~s')(Number(d))));
      }
      chart.append('g').attr('class', 'chart-axis').attr('transform', `translate(0,${innerHeight})`).call(d3.axisBottom(x));
      chart
        .selectAll('rect.patent-bar')
        .data(aggregatedCategories)
        .join('rect')
        .attr('class', 'patent-bar')
        .attr('x', (d) => x(d.key) ?? 0)
        .attr('y', (d) => lowerTop + lowerY(Math.min(d.count, lowerMax)))
        .attr('width', x.bandwidth())
        .attr('height', (d) => lowerHeight - lowerY(Math.min(d.count, lowerMax)))
        .attr('rx', Math.min(9, x.bandwidth() / 2))
        .attr('ry', Math.min(9, x.bandwidth() / 2))
        .attr('fill', 'url(#patent-bar-gradient)')
        .attr('opacity', 0.96)
        .on('mouseenter', (event: MouseEvent, d) => {
          describeAggregatedBar(d.label, d.count);
          const totalPapers = d3.sum(filtered, (paper) => paper.paperCount ?? 0);
          const share = totalPapers > 0 ? (d.count / totalPapers) * 100 : 0;
          showTooltip(event, 'Patent citation bin', [`${d.label}: ${d.count.toLocaleString()} papers`, `${share.toFixed(1)}% of displayed papers`]);
        })
        .on('mousemove', (event: MouseEvent, d) => {
          const totalPapers = d3.sum(filtered, (paper) => paper.paperCount ?? 0);
          const share = totalPapers > 0 ? (d.count / totalPapers) * 100 : 0;
          showTooltip(event, 'Patent citation bin', [`${d.label}: ${d.count.toLocaleString()} papers`, `${share.toFixed(1)}% of displayed papers`]);
        })
        .on('mouseleave', fadeTooltip);

      chart
        .selectAll('text.patent-value-label')
        .data(aggregatedCategories.filter((bar) => !useBrokenAxis || bar.count <= lowerMax))
        .join('text')
        .attr('class', 'chart-value-label patent-value-label')
        .attr('x', (d) => (x(d.key) ?? 0) + x.bandwidth() / 2)
        .attr('y', (d) => lowerTop + lowerY(d.count) - 7)
        .attr('text-anchor', 'middle')
        .text((d) => d.count > 0 ? d3.format('~s')(d.count) : '');

      if (useBrokenAxis) {
        const brokenBars = aggregatedCategories.filter((bar) => bar.count > lowerMax);
        chart
          .selectAll('rect.upper-bar')
          .data(brokenBars)
          .join('rect')
          .attr('class', 'upper-bar')
          .attr('x', (d) => x(d.key) ?? 0)
          .attr('y', (d) => topY(d.count))
          .attr('width', x.bandwidth())
          .attr('height', (d) => topHeight - topY(d.count))
          .attr('rx', Math.min(9, x.bandwidth() / 2))
          .attr('ry', Math.min(9, x.bandwidth() / 2))
          .attr('fill', 'url(#patent-upper-bar-gradient)')
          .on('mouseenter', (event: MouseEvent, d) => {
            describeAggregatedBar(d.label, d.count);
            const totalPapers = d3.sum(filtered, (paper) => paper.paperCount ?? 0);
            const share = totalPapers > 0 ? (d.count / totalPapers) * 100 : 0;
            showTooltip(event, 'Patent citation bin', [`${d.label}: ${d.count.toLocaleString()} papers`, `${share.toFixed(1)}% of displayed papers`]);
          })
          .on('mousemove', (event: MouseEvent, d) => {
            const totalPapers = d3.sum(filtered, (paper) => paper.paperCount ?? 0);
            const share = totalPapers > 0 ? (d.count / totalPapers) * 100 : 0;
            showTooltip(event, 'Patent citation bin', [`${d.label}: ${d.count.toLocaleString()} papers`, `${share.toFixed(1)}% of displayed papers`]);
          })
          .on('mouseleave', fadeTooltip);
        chart
          .selectAll('g.bar-break-mark')
          .data(brokenBars)
          .join('g')
          .attr('class', 'bar-break-mark')
          .attr('transform', (d) => `translate(${x(d.key) ?? 0},${topHeight + breakGap / 2})`)
          .selectAll('line')
          .data(() => [0, 1])
          .join('line')
          .attr('x1', (_d, index) => x.bandwidth() * 0.28 + index * x.bandwidth() * 0.2)
          .attr('x2', (_d, index) => x.bandwidth() * 0.43 + index * x.bandwidth() * 0.2)
          .attr('y1', 5)
          .attr('y2', -5)
          .attr('stroke', '#0f766e')
          .attr('stroke-width', 3)
          .attr('stroke-linecap', 'round');
        chart
          .selectAll('text.upper-value-label')
          .data(brokenBars)
          .join('text')
          .attr('class', 'upper-value-label')
          .attr('x', (d) => (x(d.key) ?? 0) + x.bandwidth() / 2)
          .attr('y', (d) => Math.max(12, topY(d.count) - 6))
          .attr('text-anchor', 'middle')
          .attr('fill', '#0f172a')
          .attr('font-size', 11)
          .attr('font-weight', 750)
          .text((d) => d3.format('~s')(d.count));
      }
    } else {
      const maxValue = d3.max(bars, (bar) => bar.x1) || 1;
      const x = d3.scaleLinear().domain([0, maxValue]).nice().range([0, innerWidth]);
      const y = d3.scaleLinear().domain([0, d3.max(bars, (bar) => bar.count) || 1]).nice().range([innerHeight, 0]);
      chart.append('g').attr('class', 'chart-grid').call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat(() => ''));
      chart.append('g').attr('class', 'chart-axis').attr('transform', `translate(0,${innerHeight})`).call(d3.axisBottom(x).ticks(6));
      chart.append('g').attr('class', 'chart-axis').call(d3.axisLeft(y).ticks(5).tickFormat((d) => d3.format('~s')(Number(d))));
      chart
        .selectAll('rect.patent-bar')
        .data(bars)
        .join('rect')
        .attr('class', 'patent-bar')
        .attr('x', (d) => x(d.x0 ?? 0) + 1)
        .attr('y', (d) => y(d.count))
        .attr('width', (d) => Math.max(0, x(d.x1 ?? 0) - x(d.x0 ?? 0) - 2))
        .attr('height', (d) => innerHeight - y(d.count))
        .attr('rx', 8)
        .attr('ry', 8)
        .attr('fill', 'url(#patent-bar-gradient)')
        .on('mouseenter', (event: MouseEvent, d) => {
          describeHistogramBar(d.label, d.count);
          const share = filtered.length > 0 ? (d.count / filtered.length) * 100 : 0;
          showTooltip(event, 'Patent citation bin', [`${d.label}: ${d.count.toLocaleString()} papers`, `${share.toFixed(1)}% of displayed papers`]);
        })
        .on('mousemove', (event: MouseEvent, d) => {
          const share = filtered.length > 0 ? (d.count / filtered.length) * 100 : 0;
          showTooltip(event, 'Patent citation bin', [`${d.label}: ${d.count.toLocaleString()} papers`, `${share.toFixed(1)}% of displayed papers`]);
        })
        .on('mouseleave', fadeTooltip);
    }

    chart.append('text').attr('x', innerWidth / 2).attr('y', innerHeight + 46).attr('text-anchor', 'middle').attr('class', 'axis-label').text('Patent citation count');
    chart.append('text').attr('transform', 'rotate(-90)').attr('x', -innerHeight / 2).attr('y', -46).attr('text-anchor', 'middle').attr('class', 'axis-label').text('Number of papers');
  }, [filtered, isAggregatedDistribution, resizeTick]);

  return (
    <section className="panel-card">
      <div className="panel-header">
        <div>
          <h2>Patent Citation Distribution.</h2>
          <p className="panel-subtitle">
            {selectedYear !== null
              ? `Selected Year: ${selectedYear}`
              : isAggregatedDistribution
                ? 'All Years - aggregated distribution'
                : 'All Years'}
          </p>
        </div>
        <button className="secondary" onClick={onResetYear} disabled={selectedYear === null}>Reset Year Filter</button>
      </div>
      {loading && <div className="state-box">Loading patent citation metadata...</div>}
      {error && <div className="state-box error">{error}</div>}
      {!loading && !error && !filtered.length && selectedYear !== null && isAggregatedDistribution && !hasYearSpecificDistribution && (
        <div className="state-box">Year-specific patent citation distribution is not available in patent_count_distribution.json.</div>
      )}
      {!loading && !error && !filtered.length && !(selectedYear !== null && isAggregatedDistribution && !hasYearSpecificDistribution) && (
        <div className="state-box">Prepared patent citation JSON not loaded yet. Run the preprocessing script first.</div>
      )}
      {!loading && !error && Boolean(filtered.length) && (
        <>
          <div className="section-info-stack">
            <div className="info-panel">
              <strong>{overview?.title ?? 'Patent citation overview'}</strong>
              <span>{overview?.body ?? 'Patent citation counts across papers.'}</span>
              <span>
                {selectedYear === null
                  ? 'Hover a bar to inspect a patent-count bin.'
                  : `Showing patent citation distribution for ${selectedYear}. Hover a bar to inspect a bin.`}
              </span>
            </div>
            <div className="info-panel detail-panel">
              <strong>{barDetail?.title ?? 'Patent-count detail'}</strong>
              <span>{barDetail?.body ?? 'Hover a bar to show patent-count details here.'}</span>
            </div>
          </div>
          <div ref={wrapperRef} className="chart-shell compact-chart">
            <svg ref={svgRef} role="img" aria-label="Patent citation distribution histogram" />
            {tooltip && (
              <div className={`floating-tooltip ${tooltip.visible ? 'visible' : 'fading'}`} style={{ left: tooltip.x + 16, top: tooltip.y + 8 }}>
                <strong>{tooltip.title}</strong>
                {tooltip.lines.map((line) => <span key={line}>{line}</span>)}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
