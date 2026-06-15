import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent } from 'react';
import * as d3 from 'd3';
import type { GraphLink, PaperNode } from '../types/data';

interface PaperCitationNetworkProps {
  nodes: PaperNode[];
  links: GraphLink[];
  loading: boolean;
  error?: string;
}

type DisplayLimit = number | 'all';

type CanvasNode = PaperNode & {
  color: string;
  radius: number;
  connectedCount: number;
  x: number;
  y: number;
  anchorX?: number;
  anchorY?: number;
  fx?: number | null;
  fy?: number | null;
};

type CanvasLink = GraphLink & {
  source: CanvasNode;
  target: CanvasNode;
};

type PanSubject = {
  isPanSubject: true;
  startX: number;
  startY: number;
  startTransform: d3.ZoomTransform;
};

interface Detail {
  key: string;
  title: string;
  lines: string[];
}

interface FloatingDetail extends Detail {
  x: number;
  y: number;
  visible: boolean;
}

const graphPalette = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#b07aa1', '#edc948', '#76b7b2', '#ff9da7', '#9c755f', '#bab0ac'];
const dynamicNodeLimit = 2000;
const defaultDisplayLimit = 500;
const citationCountOptions = [0, 1, 5, 10, 25, 50, 100];
const degreeCountOptions = [0, 1, 2, 5, 10, 25, 50];
const patentCountOptions = [0, 1, 2, 5, 10, 25, 50];
const referenceCountOptions = [0, 5, 10, 25, 50, 100];
const displayLimitOptions: DisplayLimit[] = [250, 500, 1000, 2000, 5000, 'all'];

function linkId(value: string | PaperNode) {
  return typeof value === 'string' ? value : value.id;
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return hash;
}

function seededUnit(value: string, salt = '') {
  return (stableHash(`${value}:${salt}`) % 10000) / 10000;
}

function seededScatterPosition(id: string, index: number, width: number, height: number, spread = 1, group = 'network') {
  const groupX = 0.18 + seededUnit(group, 'group-x') * 0.64;
  const groupY = 0.18 + seededUnit(group, 'group-y') * 0.64;
  const xNoise = (seededUnit(id, 'x') - 0.5) * 0.92 * spread;
  const yNoise = (seededUnit(id, 'y') - 0.5) * 0.92 * spread;
  const skew = (seededUnit(`${id}-${index}`, 'skew') - 0.5) * 0.16 * spread;
  const wave = Math.sin((index * 0.73 + seededUnit(group, 'wave') * 6.28)) * 0.045 * spread;
  return {
    x: width * Math.max(0.04, Math.min(0.96, groupX + xNoise * 0.52 + skew)),
    y: height * Math.max(0.06, Math.min(0.94, groupY + yNoise * 0.48 + wave - skew * 0.35))
  };
}

function fitTransformForNodes(nodes: CanvasNode[], width: number, height: number, padding = 42) {
  if (!nodes.length) return d3.zoomIdentity;
  const minX = d3.min(nodes, (node) => node.x - node.radius) ?? 0;
  const maxX = d3.max(nodes, (node) => node.x + node.radius) ?? width;
  const minY = d3.min(nodes, (node) => node.y - node.radius) ?? 0;
  const maxY = d3.max(nodes, (node) => node.y + node.radius) ?? height;
  const graphWidth = Math.max(1, maxX - minX);
  const graphHeight = Math.max(1, maxY - minY);
  const scale = Math.min((width - padding * 2) / graphWidth, (height - padding * 2) / graphHeight, 1.25);
  return d3.zoomIdentity
    .translate(width / 2 - ((minX + maxX) / 2) * scale, height / 2 - ((minY + maxY) / 2) * scale)
    .scale(scale);
}

function centerCroppedTransform(width: number, height: number, scale = 3) {
  return d3.zoomIdentity
    .translate(width / 2 - (width / 2) * scale, height / 2 - (height / 2) * scale)
    .scale(scale);
}

function isPanSubject(subject: CanvasNode | PanSubject): subject is PanSubject {
  return 'isPanSubject' in subject;
}

function displayLimitLabel(value: DisplayLimit) {
  if (value === 'all') return 'All (highly unrecommended)';
  const label = `Top ${value.toLocaleString()}`;
  return value >= 5000 ? `${label} (highly unrecommended)` : label;
}

function finiteYears(nodes: PaperNode[]) {
  return [...new Set(nodes.map((node) => node.year).filter((year): year is number => Number.isFinite(year)))].sort((a, b) => a - b);
}

function communityKey(node: PaperNode) {
  if (node.cluster) return String(node.cluster);
  if (node.topic) return String(node.topic);
  if (node.doctype) return String(node.doctype);
  if (Number.isFinite(node.year)) return String(node.year);
  return 'paper';
}

function importance(node: PaperNode, degree: number) {
  return degree * 4 + node.citationCount * 3 + (node.patentCount ?? 0) * 2 + (node.referenceCount ?? 0);
}

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function findNodeAt(nodes: CanvasNode[], x: number, y: number) {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    const dx = x - node.x;
    const dy = y - node.y;
    if (dx * dx + dy * dy <= Math.max(node.radius + 4, 7) ** 2) return node;
  }
  return null;
}

export function PaperCitationNetwork({ nodes, links, loading, error }: PaperCitationNetworkProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const simulationRef = useRef<d3.Simulation<CanvasNode, CanvasLink> | null>(null);
  const transformRef = useRef(d3.zoomIdentity);
  const defaultTransformRef = useRef(d3.zoomIdentity);
  const graphRef = useRef<{ nodes: CanvasNode[]; links: CanvasLink[]; staticMode: boolean }>({ nodes: [], links: [], staticMode: false });
  const tooltipTimerRef = useRef<number | null>(null);

  const [startYear, setStartYear] = useState<number | 'all'>('all');
  const [minCitations, setMinCitations] = useState(0);
  const [minDegree, setMinDegree] = useState(0);
  const [minPatentCount, setMinPatentCount] = useState(0);
  const [minReferenceCount, setMinReferenceCount] = useState(0);
  const [displayLimit, setDisplayLimit] = useState<DisplayLimit>(defaultDisplayLimit);
  const [hideIsolated, setHideIsolated] = useState(true);
  const [hoverDetail, setHoverDetail] = useState<Detail | null>(null);
  const [pinnedDetail, setPinnedDetail] = useState<Detail | null>(null);
  const [floatingDetail, setFloatingDetail] = useState<FloatingDetail | null>(null);
  const [resizeTick, setResizeTick] = useState(0);

  const years = useMemo(() => finiteYears(nodes), [nodes]);

  const degreeById = useMemo(() => {
    const degree = new Map<string, number>();
    links.forEach((link) => {
      const source = linkId(link.source);
      const target = linkId(link.target);
      degree.set(source, (degree.get(source) ?? 0) + 1);
      degree.set(target, (degree.get(target) ?? 0) + 1);
    });
    return degree;
  }, [links]);

  const filtered = useMemo(() => {
    const firstYear = years[0] ?? Number.NEGATIVE_INFINITY;
    const lastYear = years[years.length - 1] ?? Number.POSITIVE_INFINITY;
    const lowYear = startYear === 'all' ? firstYear : startYear;
    const highYear = lastYear;

    const eligibleNodes = nodes.filter((node) => {
      const degree = node.totalDegree ?? degreeById.get(node.id) ?? 0;
      if (Number.isFinite(node.year) && (Number(node.year) < lowYear || Number(node.year) > highYear)) return false;
      if (node.citationCount < minCitations) return false;
      if (degree < minDegree) return false;
      if ((node.patentCount ?? 0) < minPatentCount) return false;
      if ((node.referenceCount ?? 0) < minReferenceCount) return false;
      if (hideIsolated && degree === 0) return false;
      return true;
    });
    const sortedNodes = [...eligibleNodes].sort((a, b) => importance(b, b.totalDegree ?? degreeById.get(b.id) ?? 0) - importance(a, a.totalDegree ?? degreeById.get(a.id) ?? 0));
    const visibleNodes = displayLimit === 'all' ? sortedNodes : sortedNodes.slice(0, displayLimit);
    const visibleIds = new Set(visibleNodes.map((node) => node.id));
    const visibleLinks = links.filter((link) => visibleIds.has(linkId(link.source)) && visibleIds.has(linkId(link.target)));
    return { nodes: visibleNodes, links: visibleLinks };
  }, [degreeById, displayLimit, hideIsolated, links, minCitations, minDegree, minPatentCount, minReferenceCount, nodes, startYear, years]);

  const staticMode = filtered.nodes.length > dynamicNodeLimit;

  const overview = useMemo(() => {
    if (!filtered.nodes.length) return null;
    const yearRange = years.length ? `${years[0]}-${years[years.length - 1]}` : 'Unknown years';
    const averageCitations = d3.mean(filtered.nodes, (node) => node.citationCount) ?? 0;
    const averagePatents = d3.mean(filtered.nodes, (node) => node.patentCount ?? 0) ?? 0;
    return {
      title: `${filtered.nodes.length.toLocaleString()} papers and ${filtered.links.length.toLocaleString()} citation links`,
      lines: [
        `Year range: ${yearRange}`,
        `Average paper citations: ${averageCitations.toFixed(2)}`,
        `Average patent citations: ${averagePatents.toFixed(2)}`,
        'Layout mode: dynamic spring layout.'
      ]
    };
  }, [filtered, staticMode, years]);

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

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper || !filtered.nodes.length) return;

    simulationRef.current?.stop();
    simulationRef.current = null;

    const width = Math.max(wrapper.clientWidth, 720);
    const height = Math.max(620, Math.round(window.innerHeight * 0.68));
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const radius = d3.scaleSqrt()
      .domain([0, d3.max(filtered.nodes, (node) => Math.max(node.citationCount, node.totalDegree ?? degreeById.get(node.id) ?? 0)) || 1])
      .range([3, 13]);

    const canvasNodes: CanvasNode[] = filtered.nodes.map((node, index) => {
      const degree = node.totalDegree ?? degreeById.get(node.id) ?? 0;
      const group = communityKey(node);
      const position = seededScatterPosition(node.id, index, width, height, staticMode ? 1.9 : 1, group);
      return {
        ...node,
        color: graphPalette[stableHash(group) % graphPalette.length],
        radius: radius(Math.max(node.citationCount, degree)),
        connectedCount: degree,
        x: position.x,
        y: position.y,
        anchorX: position.x,
        anchorY: position.y
      };
    });

    const nodeById = new Map(canvasNodes.map((node) => [node.id, node]));
    const canvasLinks = filtered.links
      .map((link) => {
        const source = nodeById.get(linkId(link.source));
        const target = nodeById.get(linkId(link.target));
        return source && target ? { ...link, source, target } : null;
      })
      .filter((link): link is CanvasLink => Boolean(link));

    graphRef.current = { nodes: canvasNodes, links: canvasLinks, staticMode };
    defaultTransformRef.current = centerCroppedTransform(width, height, 1);
    transformRef.current = defaultTransformRef.current;

    function draw() {
      const transform = transformRef.current;
      context.save();
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.translate(transform.x, transform.y);
      context.scale(transform.k, transform.k);

      context.globalAlpha = transform.k < 0.55 ? 0.12 : 0.28;
      context.strokeStyle = '#9ca3af';
      for (const link of canvasLinks) {
        context.lineWidth = Math.max(0.25, Math.min(2.4, Math.sqrt(Number(link.weight ?? 1)) / 8) / transform.k);
        context.beginPath();
        context.moveTo(link.source.x, link.source.y);
        context.lineTo(link.target.x, link.target.y);
        context.stroke();
      }

      context.globalAlpha = 0.94;
      for (const node of canvasNodes) {
        context.beginPath();
        context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        context.fillStyle = node.color;
        context.fill();
        context.strokeStyle = 'rgba(255,255,255,0.92)';
        context.lineWidth = Math.max(0.7, 1.2 / transform.k);
        context.stroke();
      }
      context.restore();
    }

    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.15, 10])
      .filter((event) => event.type === 'dblclick')
      .on('zoom', (event) => {
        transformRef.current = event.transform;
        draw();
    });
    zoomRef.current = zoom;
    d3.select(canvas).call(zoom).call(zoom.transform, defaultTransformRef.current);

    const simulation = d3.forceSimulation<CanvasNode>(canvasNodes)
      .force('link', d3.forceLink<CanvasNode, CanvasLink>(canvasLinks).id((node) => node.id).distance(42).strength(0.07))
      .force('charge', d3.forceManyBody<CanvasNode>().strength((node) => -14 - node.radius * 2.8).distanceMax(150))
      .force('center', d3.forceCenter<CanvasNode>(width / 2, height / 2))
      .force('x', d3.forceX<CanvasNode>((node) => node.anchorX ?? node.x).strength(0.025))
      .force('y', d3.forceY<CanvasNode>((node) => node.anchorY ?? node.y).strength(0.025))
      .force('collision', d3.forceCollide<CanvasNode>().radius((node) => node.radius + 3).strength(0.62))
      .alpha(1)
      .alphaDecay(staticMode ? 0.055 : 0.045)
      .velocityDecay(0.52)
      .on('tick', draw)
      .on('end', () => draw());
    simulationRef.current = simulation;
    if (staticMode) {
      window.setTimeout(() => {
        simulation.stop();
        draw();
        if (simulationRef.current === simulation) simulationRef.current = null;
      }, 3200);
    }

    const drag = d3.drag<HTMLCanvasElement, unknown, CanvasNode | PanSubject>()
      .filter((event) => !event.button)
      .subject((event) => {
        const [x, y] = transformRef.current.invert(d3.pointer(event, canvas));
        const node = findNodeAt(canvasNodes, x, y);
        if (node) return node;
        const sourceEvent = event.sourceEvent as globalThis.MouseEvent;
        return {
          isPanSubject: true,
          startX: sourceEvent.clientX,
          startY: sourceEvent.clientY,
          startTransform: transformRef.current
        };
      })
      .on('start', (event) => {
        if (!event.subject) return;
        if (isPanSubject(event.subject)) {
          canvas.style.cursor = 'grabbing';
          return;
        }
        if (simulationRef.current && !event.active) simulationRef.current.alphaTarget(0.18).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
        canvas.style.cursor = 'grabbing';
      })
      .on('drag', (event) => {
        if (!event.subject) return;
        if (isPanSubject(event.subject)) {
          const sourceEvent = event.sourceEvent as globalThis.MouseEvent;
          const nextTransform = d3.zoomIdentity
            .translate(event.subject.startTransform.x + sourceEvent.clientX - event.subject.startX, event.subject.startTransform.y + sourceEvent.clientY - event.subject.startY)
            .scale(event.subject.startTransform.k);
          d3.select(canvas).call(zoom.transform, nextTransform);
          return;
        }
        const [x, y] = transformRef.current.invert(d3.pointer(event, canvas));
        event.subject.x = x;
        event.subject.y = y;
        event.subject.fx = x;
        event.subject.fy = y;
        draw();
      })
      .on('end', (event) => {
        if (!event.subject) return;
        if (isPanSubject(event.subject)) {
          canvas.style.cursor = 'grab';
          return;
        }
        if (simulationRef.current && !event.active) simulationRef.current.alphaTarget(0);
        event.subject.fx = null;
        event.subject.fy = null;
        canvas.style.cursor = 'grab';
      });
    d3.select(canvas).call(drag);

    return () => {
      simulationRef.current?.stop();
      simulationRef.current = null;
      d3.select(canvas).on('.zoom', null).on('.drag', null);
      context.clearRect(0, 0, width, height);
    };
  }, [degreeById, filtered, resizeTick, staticMode]);

  function findItemAt(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const [x, y] = transformRef.current.invert([clientX - rect.left, clientY - rect.top]);
    const graph = graphRef.current;
    const node = findNodeAt(graph.nodes, x, y);
    if (node) return { type: 'node' as const, node };
    if (graph.staticMode) return null;
    for (const link of graph.links) {
      const distance = distanceToSegment(x, y, link.source.x, link.source.y, link.target.x, link.target.y);
      if (distance <= Math.max(5, Math.sqrt(Number(link.weight ?? 1)) / 2)) return { type: 'link' as const, link };
    }
    return null;
  }

  function nodeLines(node: CanvasNode) {
    return [
      `Paper ID: ${node.id}`,
      Number.isFinite(node.year) ? `Year: ${node.year}` : 'Year: Unknown',
      `Citation count: ${node.citationCount}`,
      `Total degree: ${node.totalDegree ?? node.connectedCount}`,
      `Patent count: ${node.patentCount ?? 0}`
    ];
  }

  function itemDetail(item: ReturnType<typeof findItemAt>): Detail | null {
    if (!item) return null;
    if (item.type === 'node') {
      return {
        key: `node:${item.node.id}`,
        title: item.node.title ?? item.node.id,
        lines: nodeLines(item.node)
      };
    }
    return {
      key: `link:${item.link.source.id}:${item.link.target.id}`,
      title: 'Citation edge',
      lines: [
        `Source: ${item.link.source.title ?? item.link.source.id}`,
        `Target: ${item.link.target.title ?? item.link.target.id}`,
        `Weight: ${item.link.weight ?? 1}`
      ]
    };
  }

  function showFloating(event: PointerEvent<HTMLCanvasElement>, detail: Detail) {
    if (tooltipTimerRef.current !== null) window.clearTimeout(tooltipTimerRef.current);
    setFloatingDetail({ ...detail, x: event.clientX, y: event.clientY, visible: true });
  }

  function fadeFloating() {
    setFloatingDetail((current) => current ? { ...current, visible: false } : current);
    if (tooltipTimerRef.current !== null) window.clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = window.setTimeout(() => setFloatingDetail(null), 1800);
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const item = findItemAt(event.clientX, event.clientY);
    if (!item) {
      if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
      fadeFloating();
      return;
    }
    if (canvasRef.current) canvasRef.current.style.cursor = 'pointer';
    const detail = itemDetail(item);
    if (!detail) return;
    showFloating(event, detail);
    if (!pinnedDetail) setHoverDetail(detail);
  }

  function handleCanvasClick(event: ReactMouseEvent<HTMLCanvasElement>) {
    const detail = itemDetail(findItemAt(event.clientX, event.clientY));
    if (detail && pinnedDetail?.key === detail.key) {
      setPinnedDetail(null);
      setHoverDetail(null);
      return;
    }
    setPinnedDetail(detail);
    setHoverDetail(detail);
  }

  function resetFilters() {
    setStartYear('all');
    setMinCitations(0);
    setMinDegree(0);
    setMinPatentCount(0);
    setMinReferenceCount(0);
    setDisplayLimit(defaultDisplayLimit);
    setHideIsolated(true);
    setPinnedDetail(null);
    setHoverDetail(null);
  }

  function resetView() {
    const canvas = canvasRef.current;
    const zoom = zoomRef.current;
    if (canvas && zoom) d3.select(canvas).transition().duration(350).call(zoom.transform, defaultTransformRef.current);
  }

  function zoomBy(scaleFactor: number) {
    const canvas = canvasRef.current;
    const zoom = zoomRef.current;
    if (canvas && zoom) d3.select(canvas).transition().duration(250).call(zoom.scaleBy, scaleFactor);
  }

  const displayedDetail = pinnedDetail ?? hoverDetail;

  return (
    <section className="panel-card wide-panel bundled-network-panel">
      <div className="panel-header">
        <div>
          <h2>Paper Citation Network, UW-Madison CS, 2019-2024.</h2>
          <p className="panel-subtitle">Citation graph with display-size controls and dynamic layout for filtered views.</p>
        </div>
      </div>

      <div className="paper-filter-bar">
        <label>
          Year from
          <select value={startYear} onChange={(event) => setStartYear(event.target.value === 'all' ? 'all' : Number(event.target.value))}>
            <option value="all">All years</option>
            {years.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>
        <label>
          Min citations
          <select value={minCitations} onChange={(event) => setMinCitations(Number(event.target.value))}>
            {citationCountOptions.map((count) => <option key={count} value={count}>{count}+</option>)}
          </select>
        </label>
        <label>
          Min degree
          <select value={minDegree} onChange={(event) => setMinDegree(Number(event.target.value))}>
            {degreeCountOptions.map((count) => <option key={count} value={count}>{count}+</option>)}
          </select>
        </label>
        <label>
          Min patents
          <select value={minPatentCount} onChange={(event) => setMinPatentCount(Number(event.target.value))}>
            {patentCountOptions.map((count) => <option key={count} value={count}>{count}+</option>)}
          </select>
        </label>
        <label>
          Min references
          <select value={minReferenceCount} onChange={(event) => setMinReferenceCount(Number(event.target.value))}>
            {referenceCountOptions.map((count) => <option key={count} value={count}>{count}+</option>)}
          </select>
        </label>
        <label>
          Display papers
          <select value={displayLimit} onChange={(event) => setDisplayLimit(event.target.value === 'all' ? 'all' : Number(event.target.value))}>
            {displayLimitOptions.map((count) => <option key={count} value={count}>{displayLimitLabel(count)}</option>)}
          </select>
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={hideIsolated} onChange={(event) => setHideIsolated(event.target.checked)} />
          Hide isolated
        </label>
        <button type="button" className="secondary" onClick={resetFilters}>Reset</button>
      </div>

      {loading && <div className="state-box">Loading paper citation data...</div>}
      {error && <div className="state-box error">{error}</div>}
      {!loading && !error && !filtered.nodes.length && <div className="state-box">No paper citation network matches the current filters.</div>}
      {!loading && !error && Boolean(filtered.nodes.length) && (
        <>
          <div className="section-info-stack">
            <div className="info-panel">
              <strong>{overview?.title ?? 'Paper citation overview'}</strong>
              {(overview?.lines ?? ['Paper nodes connected by citation relationships.']).map((line) => <span key={line}>{line}</span>)}
              <span>Drag empty space to move the network. Dynamic node dragging is enabled at 2,000 or fewer visible papers.</span>
            </div>
            <div className="info-panel detail-panel">
              <strong>{displayedDetail ? `${pinnedDetail ? 'Pinned: ' : ''}${displayedDetail.title}` : 'Paper detail'}</strong>
              {(displayedDetail?.lines ?? [
                `${filtered.nodes.length.toLocaleString()} papers currently displayed`,
                `${filtered.links.length.toLocaleString()} citation links currently displayed`,
                'Hover a node or edge to show details. Click one to keep the details fixed; click it again to unpin.'
              ]).map((line) => <span key={line}>{line}</span>)}
            </div>
          </div>
          <div ref={wrapperRef} className="chart-shell citation-network-shell bundled-network-shell">
            <div className="network-overlay-actions" aria-label="Paper citation network view controls">
              <button type="button" className="icon-button" onClick={() => zoomBy(1.25)} aria-label="Zoom in paper citation network">+</button>
              <button type="button" className="icon-button" onClick={() => zoomBy(0.8)} aria-label="Zoom out paper citation network">-</button>
              <button type="button" className="secondary" onClick={resetView}>Reset View</button>
            </div>
            <canvas
              ref={canvasRef}
              className="network-canvas"
              role="img"
              aria-label="Paper citation force-directed graph"
              onPointerMove={handlePointerMove}
              onPointerLeave={fadeFloating}
              onClick={handleCanvasClick}
            />
            {floatingDetail && (
              <div className={`floating-tooltip ${floatingDetail.visible ? 'visible' : 'fading'}`} style={{ left: floatingDetail.x + 16, top: floatingDetail.y + 8 }}>
                <strong>{floatingDetail.title}</strong>
                {floatingDetail.lines.map((line) => <span key={line}>{line}</span>)}
              </div>
            )}
          </div>
        </>
      )}

      <div className="legend-card bundled-legend">
        <strong>Legend</strong>
        <ul>
          <li>Node = paper; edge = citation relationship.</li>
          <li>Node size represents citation count or total degree.</li>
          <li>Node color represents year, topic, document type, or cluster.</li>
        </ul>
      </div>
    </section>
  );
}
