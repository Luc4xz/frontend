import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent } from 'react';
import * as d3 from 'd3';
import type { AuthorLink, AuthorNode } from '../types/data';

interface AuthorCollaborationNetworkProps {
  nodes: AuthorNode[];
  links: AuthorLink[];
  loading: boolean;
  missing: boolean;
  error?: string;
}

type DisplayLimit = number | 'all';

type CanvasNode = AuthorNode & {
  color: string;
  radius: number;
  x: number;
  y: number;
  fx?: number | null;
  fy?: number | null;
};

type CanvasLink = AuthorLink & {
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
const dynamicNodeLimit = 1000;
const defaultDisplayLimit = 1000;
const staticRenderLinkLimit = 80000;
const paperCountOptions = [1, 2, 5, 10, 25, 50, 100];
const collaboratorCountOptions = [0, 5, 10, 25, 50, 100, 200];
const sharedPaperOptions = [1, 2, 5, 10, 25, 50, 100];
const displayLimitOptions: DisplayLimit[] = [250, 500, 1000, 2000, 5000, 'all'];

function endpointId(value: string | AuthorNode) {
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
  const angle = seededUnit(id, 'angle') * Math.PI * 2;
  const radius = Math.sqrt(seededUnit(id, 'radius')) * Math.min(width, height) * 0.46 * spread;
  const wobbleX = (seededUnit(id, 'wobble-x') - 0.5) * Math.min(width, height) * 0.18 * spread;
  const wobbleY = (seededUnit(id, 'wobble-y') - 0.5) * Math.min(width, height) * 0.18 * spread;
  const groupAngle = seededUnit(group, 'group-angle') * Math.PI * 2;
  const groupRadius = Math.sqrt(seededUnit(group, 'group-radius')) * Math.min(width, height) * 0.16 * spread;
  const rowOffset = ((index % 9) - 4) * 1.7;
  return {
    x: width / 2 + Math.cos(groupAngle) * groupRadius + Math.cos(angle) * radius + wobbleX + rowOffset,
    y: height / 2 + Math.sin(groupAngle) * groupRadius * 0.74 + Math.sin(angle) * radius * 0.74 + wobbleY - rowOffset
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

function isPanSubject(subject: CanvasNode | PanSubject): subject is PanSubject {
  return 'isPanSubject' in subject;
}

function groupKey(node: AuthorNode) {
  return String(node.cluster ?? node.institution ?? 'author');
}

function displayLimitLabel(value: DisplayLimit) {
  if (value === 'all') return 'All (highly unrecommended)';
  const label = `Top ${value.toLocaleString()}`;
  return value >= 5000 ? `${label} (highly unrecommended)` : label;
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function collectYears(record: Record<string, unknown> | undefined) {
  if (!record) return [];
  const fields = ['year', 'publication_year', 'publicationYear', 'years', 'publication_years', 'publicationYears', 'shared_years', 'sharedYears'];
  return fields.flatMap((field) => {
    const value = record[field];
    const values = Array.isArray(value) ? value : [value];
    return values.map(numberValue).filter((year): year is number => Number.isFinite(year) && year >= 1900 && year <= 2100);
  });
}

function itemYears(item: AuthorNode | AuthorLink) {
  return [...collectYears(item as unknown as Record<string, unknown>), ...collectYears(item.raw as Record<string, unknown> | undefined)];
}

function overlapsYearRange(years: number[], startYear: number, endYear: number) {
  if (!years.length) return true;
  return years.some((year) => year >= startYear && year <= endYear);
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

export function AuthorCollaborationNetwork({ nodes, links, loading, missing, error }: AuthorCollaborationNetworkProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const simulationRef = useRef<d3.Simulation<CanvasNode, CanvasLink> | null>(null);
  const transformRef = useRef(d3.zoomIdentity);
  const defaultTransformRef = useRef(d3.zoomIdentity);
  const graphRef = useRef<{ nodes: CanvasNode[]; links: CanvasLink[]; staticMode: boolean }>({ nodes: [], links: [], staticMode: false });
  const tooltipTimerRef = useRef<number | null>(null);

  const [minPaperCount, setMinPaperCount] = useState(1);
  const [minCollaboratorCount, setMinCollaboratorCount] = useState(0);
  const [minSharedPapers, setMinSharedPapers] = useState(1);
  const [displayLimit, setDisplayLimit] = useState<DisplayLimit>(defaultDisplayLimit);
  const [startYear, setStartYear] = useState<number | 'all'>('all');
  const [endYear, setEndYear] = useState<number | 'all'>('all');
  const [hoverDetail, setHoverDetail] = useState<Detail | null>(null);
  const [pinnedDetail, setPinnedDetail] = useState<Detail | null>(null);
  const [floatingDetail, setFloatingDetail] = useState<FloatingDetail | null>(null);
  const [resizeTick, setResizeTick] = useState(0);

  const yearOptions = useMemo(() => {
    const years = new Set<number>();
    nodes.forEach((node) => itemYears(node).forEach((year) => years.add(year)));
    links.forEach((link) => itemYears(link).forEach((year) => years.add(year)));
    return [...years].sort((a, b) => a - b);
  }, [links, nodes]);

  const filtered = useMemo(() => {
    const firstYear = yearOptions[0] ?? Number.NEGATIVE_INFINITY;
    const lastYear = yearOptions[yearOptions.length - 1] ?? Number.POSITIVE_INFINITY;
    const rangeStart = startYear === 'all' ? firstYear : startYear;
    const rangeEnd = endYear === 'all' ? lastYear : endYear;
    const lowYear = Math.min(rangeStart, rangeEnd);
    const highYear = Math.max(rangeStart, rangeEnd);
    const hasYearFilter = Boolean(yearOptions.length);

    const eligibleLinks = links.filter((link) =>
      Number(link.weight ?? link.raw.shared_paper_count ?? 1) >= minSharedPapers &&
      (!hasYearFilter || overlapsYearRange(itemYears(link), lowYear, highYear))
    );
    const linkedIds = new Set<string>();
    eligibleLinks.forEach((link) => {
      linkedIds.add(endpointId(link.source));
      linkedIds.add(endpointId(link.target));
    });

    const eligibleNodes = nodes.filter((node) =>
      node.paperCount >= minPaperCount &&
      Number(node.collaborationCount ?? 0) >= minCollaboratorCount &&
      (!hasYearFilter || overlapsYearRange(itemYears(node), lowYear, highYear) || linkedIds.has(node.id))
    );
    const sortedNodes = [...eligibleNodes].sort((a, b) => b.paperCount - a.paperCount);
    const visibleNodes = displayLimit === 'all' ? sortedNodes : sortedNodes.slice(0, displayLimit);
    const visibleIds = new Set(visibleNodes.map((node) => node.id));
    const visibleLinks = eligibleLinks.filter((link) => visibleIds.has(endpointId(link.source)) && visibleIds.has(endpointId(link.target)));
    return { nodes: visibleNodes, links: visibleLinks };
  }, [displayLimit, endYear, links, minCollaboratorCount, minPaperCount, minSharedPapers, nodes, startYear, yearOptions]);

  const staticMode = filtered.nodes.length >= dynamicNodeLimit;

  const overview = useMemo(() => {
    if (!filtered.nodes.length) return null;
    const totalPapers = d3.sum(filtered.nodes, (node) => node.paperCount);
    const averagePapers = d3.mean(filtered.nodes, (node) => node.paperCount) ?? 0;
    const averageCollaborators = d3.mean(filtered.nodes, (node) => node.collaborationCount ?? 0) ?? 0;
    const averageShared = d3.mean(filtered.links, (link) => Number(link.weight ?? 0)) ?? 0;
    return {
      title: `${filtered.nodes.length.toLocaleString()} authors and ${filtered.links.length.toLocaleString()} collaboration links`,
      lines: [
        `${totalPapers.toLocaleString()} total author-paper contributions`,
        `Average papers per author: ${averagePapers.toFixed(2)}`,
        `Average collaborators per author: ${averageCollaborators.toFixed(2)}`,
        `Average shared papers per link: ${averageShared.toFixed(2)}`,
        staticMode ? 'Layout mode: static fitted layout for scale.' : 'Layout mode: dynamic force layout.'
      ]
    };
  }, [filtered, staticMode]);

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

    const width = Math.max(wrapper.clientWidth, 640);
    const height = 560;
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const radius = d3.scaleSqrt().domain([0, d3.max(filtered.nodes, (node) => node.paperCount) || 1]).range([2.4, 11]);
    const canvasNodes: CanvasNode[] = filtered.nodes.map((node, index) => {
      const group = groupKey(node);
      const position = seededScatterPosition(node.id, index, width, height, 1, group);
      return {
        ...node,
        color: graphPalette[stableHash(group) % graphPalette.length],
        radius: radius(node.paperCount),
        x: position.x,
        y: position.y
      };
    });

    const nodeById = new Map(canvasNodes.map((node) => [node.id, node]));
    const linksForCanvas = staticMode && filtered.links.length > staticRenderLinkLimit
      ? [...filtered.links].sort((a, b) => Number(b.weight ?? b.raw?.shared_paper_count ?? 1) - Number(a.weight ?? a.raw?.shared_paper_count ?? 1)).slice(0, staticRenderLinkLimit)
      : filtered.links;
    const canvasLinks = linksForCanvas
      .map((link) => {
        const source = nodeById.get(endpointId(link.source));
        const target = nodeById.get(endpointId(link.target));
        return source && target ? { ...link, source, target } : null;
      })
      .filter((link): link is CanvasLink => Boolean(link));

    if (staticMode) {
      const groupCounts = d3.rollup(canvasNodes, (groupNodes) => groupNodes.length, (node) => groupKey(node));
      const groups = Array.from(groupCounts, ([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
      const worldRadius = Math.max(5200, Math.sqrt(canvasNodes.length) * 34);
      const clusterCenter = new Map<string, { x: number; y: number; radius: number }>();
      groups.forEach((group, index) => {
        const angle = (index / Math.max(groups.length, 1)) * Math.PI * 2 + seededUnit(group.key, 'cluster') * Math.PI * 2;
        const orbit = worldRadius * (0.18 + 0.72 * Math.sqrt((index + 1) / Math.max(groups.length, 1)));
        clusterCenter.set(group.key, {
          x: width / 2 + Math.cos(angle) * orbit,
          y: height / 2 + Math.sin(angle) * orbit * 0.72,
          radius: Math.max(140, Math.sqrt(group.count) * 24)
        });
      });
      const localIndexByGroup = new Map<string, number>();
      canvasNodes.forEach((node) => {
        const key = groupKey(node);
        const center = clusterCenter.get(key) ?? { x: width / 2, y: height / 2, radius: worldRadius * 0.25 };
        const localIndex = localIndexByGroup.get(key) ?? 0;
        localIndexByGroup.set(key, localIndex + 1);
        const angle = seededUnit(`${node.id}-${localIndex}`, 'local') * Math.PI * 2;
        const spread = Math.sqrt((localIndex + 1) / Math.max(groupCounts.get(key) ?? 1, 1)) * center.radius;
        const jitter = 0.78 + seededUnit(node.id, 'jitter') * 0.2;
        node.x = center.x + Math.cos(angle) * spread * jitter;
        node.y = center.y + Math.sin(angle) * spread * jitter;
      });
    }

    graphRef.current = { nodes: canvasNodes, links: canvasLinks, staticMode };
    defaultTransformRef.current = staticMode ? fitTransformForNodes(canvasNodes, width, height, 42) : d3.zoomIdentity;
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
        context.lineWidth = Math.max(0.25, Math.min(2.4, Math.sqrt(Number(link.weight ?? 1)) / 7) / transform.k);
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
      .filter((event) => event.type === 'wheel' || event.type === 'dblclick')
      .on('zoom', (event) => {
        transformRef.current = event.transform;
        draw();
      });
    zoomRef.current = zoom;
    d3.select(canvas).call(zoom).call(zoom.transform, defaultTransformRef.current);

    const simulation = staticMode ? null : d3.forceSimulation<CanvasNode>(canvasNodes)
      .force('link', d3.forceLink<CanvasNode, CanvasLink>(canvasLinks).id((node) => node.id).distance(34).strength(0.22))
      .force('charge', d3.forceManyBody<CanvasNode>().strength((node) => -20 - node.radius * 3.2).distanceMax(220))
      .force('center', d3.forceCenter<CanvasNode>(width / 2, height / 2))
      .force('x', d3.forceX<CanvasNode>(width / 2).strength(0.045))
      .force('y', d3.forceY<CanvasNode>(height / 2).strength(0.045))
      .force('collision', d3.forceCollide<CanvasNode>().radius((node) => node.radius + 2.5).strength(0.55))
      .alpha(1)
      .alphaDecay(staticMode ? 0.08 : 0.035)
      .velocityDecay(0.46)
      .on('tick', draw)
      .on('end', () => {
        draw();
        if (staticMode) simulationRef.current = null;
      });
    simulationRef.current = simulation;
    if (staticMode) draw();

    const drag = d3.drag<HTMLCanvasElement, unknown, CanvasNode | PanSubject>()
      .filter((event) => !event.button)
      .subject((event) => {
        const [x, y] = transformRef.current.invert(d3.pointer(event, canvas));
        const node = !staticMode
          ? simulationRef.current?.find(x, y, 24 / transformRef.current.k) ?? findNodeAt(canvasNodes, x, y)
          : null;
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
        if (simulationRef.current && !event.active) simulationRef.current.alphaTarget(0.22).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
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
        if (simulationRef.current && !event.active) {
          simulationRef.current.alpha(0.32).alphaTarget(0).restart();
        }
        event.subject.fx = null;
        event.subject.fy = null;
        if (staticMode) {
          event.subject.fx = null;
          event.subject.fy = null;
        }
      });
    d3.select(canvas).call(drag);

    return () => {
      simulationRef.current?.stop();
      simulationRef.current = null;
      d3.select(canvas).on('.zoom', null).on('.drag', null);
      context.clearRect(0, 0, width, height);
    };
  }, [filtered, resizeTick, staticMode]);

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

  function itemDetail(item: ReturnType<typeof findItemAt>): Detail | null {
    if (!item) return null;
    if (item.type === 'node') {
      return {
        key: `node:${item.node.id}`,
        title: item.node.name,
        lines: [
          `Author ID: ${item.node.id}`,
          `Paper count: ${item.node.paperCount}`,
          `Collaborator count: ${item.node.collaborationCount ?? 0}`,
          item.node.institution ? `Institution: ${item.node.institution}` : ''
        ].filter(Boolean)
      };
    }
    return {
      key: `link:${item.link.source.id}:${item.link.target.id}`,
      title: 'Collaboration link',
      lines: [
        `Source: ${item.link.source.name}`,
        `Target: ${item.link.target.name}`,
        `Shared papers: ${item.link.weight ?? item.link.raw.shared_paper_count ?? 1}`
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
    <section className="panel-card wide-panel">
      <div className="panel-header">
        <div>
          <h2>UW-Madison 5-Year Author Collaboration Network.</h2>
          <p className="panel-subtitle">Traditional force-directed collaboration graph with draggable author nodes.</p>
        </div>
      </div>

      <div className="panel-controls">
        <label>
          Year from
          <select value={startYear} onChange={(event) => setStartYear(event.target.value === 'all' ? 'all' : Number(event.target.value))} disabled={!yearOptions.length}>
            <option value="all">All years</option>
            {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>
        <label>
          Year to
          <select value={endYear} onChange={(event) => setEndYear(event.target.value === 'all' ? 'all' : Number(event.target.value))} disabled={!yearOptions.length}>
            <option value="all">All years</option>
            {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>
        <label>
          Min papers
          <select value={minPaperCount} onChange={(event) => setMinPaperCount(Number(event.target.value))}>
            {paperCountOptions.map((count) => <option key={count} value={count}>{count}+</option>)}
          </select>
        </label>
        <label>
          Min collaborators
          <select value={minCollaboratorCount} onChange={(event) => setMinCollaboratorCount(Number(event.target.value))}>
            {collaboratorCountOptions.map((count) => <option key={count} value={count}>{count}+</option>)}
          </select>
        </label>
        <label>
          Min shared papers
          <select value={minSharedPapers} onChange={(event) => setMinSharedPapers(Number(event.target.value))}>
            {sharedPaperOptions.map((count) => <option key={count} value={count}>{count}+</option>)}
          </select>
        </label>
        <label>
          Display authors
          <select value={displayLimit} onChange={(event) => setDisplayLimit(event.target.value === 'all' ? 'all' : Number(event.target.value))}>
            {displayLimitOptions.map((count) => <option key={count} value={count}>{displayLimitLabel(count)}</option>)}
          </select>
        </label>
      </div>
      {!yearOptions.length && !loading && !missing && (
        <div className="control-note">Year filters will activate when author collaboration data includes year fields.</div>
      )}

      {error && <div className="state-box error">{error}</div>}
      {!loading && missing && <div className="state-box">Author collaboration data not loaded yet.</div>}
      {!loading && !missing && !filtered.nodes.length && <div className="state-box">No author collaboration network matches the current controls.</div>}
      {!loading && !missing && Boolean(filtered.nodes.length) && (
        <>
          <div className="section-info-stack">
            <div className="info-panel">
              <strong>{overview?.title ?? 'Author collaboration overview'}</strong>
              {(overview?.lines ?? ['Author nodes connected by co-authorship relationships.']).map((line) => <span key={line}>{line}</span>)}
              <span>Drag empty space to move the network. Dynamic node dragging is enabled below 1,000 visible nodes; larger views use a fitted static layout.</span>
            </div>
            <div className="info-panel detail-panel">
              <strong>{displayedDetail ? `${pinnedDetail ? 'Pinned: ' : ''}${displayedDetail.title}` : 'Author or collaboration detail'}</strong>
              {(displayedDetail?.lines ?? [
                `${filtered.nodes.length.toLocaleString()} authors currently displayed`,
                `${filtered.links.length.toLocaleString()} collaboration links currently displayed`,
                'Hover a node or edge to show details here. Click one to keep the details fixed; click it again to unpin.'
              ]).map((line) => <span key={line}>{line}</span>)}
            </div>
          </div>
          <div ref={wrapperRef} className="chart-shell citation-network-shell">
            <div className="network-overlay-actions" aria-label="Author collaboration network view controls">
              <button type="button" className="icon-button" onClick={() => zoomBy(1.25)} aria-label="Zoom in author collaboration network">+</button>
              <button type="button" className="icon-button" onClick={() => zoomBy(0.8)} aria-label="Zoom out author collaboration network">-</button>
              <button type="button" className="secondary" onClick={resetView}>Reset View</button>
            </div>
            <canvas
              ref={canvasRef}
              className="network-canvas"
              role="img"
              aria-label="Author collaboration force-directed graph"
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

      <div className="legend-card">
        <strong>Legend</strong>
        <ul>
          <li>Node = author; edge = co-authorship relationship.</li>
          <li>Node size represents paper count when available.</li>
          <li>Node color represents institution, cluster, or group when available.</li>
          <li>Filters limit authors by paper count, collaborator count, shared-paper strength, and display size.</li>
        </ul>
      </div>
    </section>
  );
}
