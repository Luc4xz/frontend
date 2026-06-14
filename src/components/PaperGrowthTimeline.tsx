import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { YearCount } from '../types/data';

interface PaperGrowthTimelineProps {
  data: YearCount[];
  selectedYear: number | null;
  onSelectYear: (year: number) => void;
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

export function PaperGrowthTimeline({ data, selectedYear, onSelectYear, loading, error }: PaperGrowthTimelineProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [barDetail, setBarDetail] = useState<DetailCard | null>(null);
  const [tooltip, setTooltip] = useState<FloatingTooltip | null>(null);
  const tooltipTimerRef = useRef<number | null>(null);
  const [resizeTick, setResizeTick] = useState(0);

  const overview = useMemo(() => {
    if (!data.length) return null;
    const totalPapers = d3.sum(data, (d) => d.count);
    const peak = d3.max(data, (d) => d.count);
    const peakYear = data.find((d) => d.count === peak)?.year;
    const firstYear = d3.min(data, (d) => d.year);
    const lastYear = d3.max(data, (d) => d.year);
    return {
      title: `${totalPapers.toLocaleString()} papers across ${data.length} years`,
      body: `Range: ${firstYear}-${lastYear}. Peak year: ${peakYear} with ${(peak ?? 0).toLocaleString()} papers.`
    };
  }, [data]);
  const totalPapers = overview ? d3.sum(data, (d) => d.count) : 0;

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
    if (!svgElement || !wrapper || !data.length) return;

    const width = Math.max(wrapper.clientWidth, 520);
    const height = 360;
    const margin = { top: 24, right: 22, bottom: 58, left: 64 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const svg = d3.select(svgElement);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const x = d3.scaleBand<number>().domain(data.map((d) => d.year)).range([0, innerWidth]).padding(0.22);
    const y = d3.scaleLinear().domain([0, d3.max(data, (d) => d.count) || 1]).nice().range([innerHeight, 0]);
    const chart = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    chart.append('g').attr('transform', `translate(0,${innerHeight})`).call(d3.axisBottom(x).tickFormat((d) => String(d)));
    chart.append('g').call(d3.axisLeft(y).ticks(5));
    chart.append('text').attr('x', innerWidth / 2).attr('y', innerHeight + 46).attr('text-anchor', 'middle').attr('class', 'axis-label').text('Year');
    chart.append('text').attr('transform', 'rotate(-90)').attr('x', -innerHeight / 2).attr('y', -46).attr('text-anchor', 'middle').attr('class', 'axis-label').text('Number of papers');

    chart
      .selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', (d) => x(d.year) ?? 0)
      .attr('y', (d) => y(d.count))
      .attr('width', x.bandwidth())
      .attr('height', (d) => innerHeight - y(d.count))
      .attr('rx', 4)
      .attr('fill', (d) => (d.year === selectedYear ? '#b91c1c' : '#2563eb'))
      .attr('opacity', 0.9)
      .attr('tabindex', 0)
      .style('cursor', 'pointer')
      .on('click', (_, d) => onSelectYear(d.year))
      .on('mouseenter', (event: MouseEvent, d) => {
        const share = totalPapers > 0 ? (d.count / totalPapers) * 100 : 0;
        setBarDetail({
          title: `${d.year}: ${d.count.toLocaleString()} papers`,
          body: `${share.toFixed(1)}% of papers in the timeline. Click this bar to filter the patent citation distribution.`
        });
        showTooltip(event, `${d.year}: ${d.count.toLocaleString()} papers`, [
          `${share.toFixed(1)}% of timeline papers`,
          'Click to filter patent citations'
        ]);
      })
      .on('mousemove', (event: MouseEvent, d) => {
        const share = totalPapers > 0 ? (d.count / totalPapers) * 100 : 0;
        showTooltip(event, `${d.year}: ${d.count.toLocaleString()} papers`, [
          `${share.toFixed(1)}% of timeline papers`,
          'Click to filter patent citations'
        ]);
      })
      .on('mouseleave', fadeTooltip);
  }, [data, onSelectYear, resizeTick, selectedYear, totalPapers]);

  return (
    <section className="panel-card">
      <div className="panel-header">
        <div>
          <h2>CS-Related Paper Growth at UW-Madison Over the Past 10 Years.</h2>
          <p className="panel-subtitle">Click a year to coordinate the patent citation histogram.</p>
        </div>
      </div>
      {loading && <div className="state-box">Loading paper growth timeline...</div>}
      {error && <div className="state-box error">{error}</div>}
      {!loading && !error && !data.length && <div className="state-box">Prepared paper growth JSON not loaded yet. Run the preprocessing script first.</div>}
      {!loading && !error && Boolean(data.length) && (
        <>
          <div className="section-info-stack">
            <div className="info-panel">
              <strong>{overview?.title ?? 'Timeline overview'}</strong>
              <span>{overview?.body ?? 'Paper counts by publication year.'}</span>
              <span>Hover a bar to inspect a year. Click a bar to update the patent citation histogram.</span>
            </div>
            <div className="info-panel detail-panel">
              <strong>{barDetail?.title ?? 'Year detail'}</strong>
              <span>{barDetail?.body ?? 'Hover a bar to show year-specific details here.'}</span>
            </div>
          </div>
          <div ref={wrapperRef} className="chart-shell compact-chart">
            <svg ref={svgRef} role="img" aria-label="Paper growth timeline" />
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
