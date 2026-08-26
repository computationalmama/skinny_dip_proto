/**
 * Seeds canvas
 *
 * An infinite canvas (React Flow) with a tray of provocations on the right.
 * Drag a seed out of the tray and it becomes a card on the canvas, where it can
 * be moved around freely.
 *
 * Bundled by build.mjs — edit this file, not the generated seeds.js.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';

import { isStatic, loadProvocations, searchPassage, zoomIn } from './data.js';

import '@xyflow/react/dist/style.css';
import './seeds.css';

const SEED_COUNT = 10;
const MIME = 'application/seed';

const CARD_W = 305;    // must track .card-wrap width in seeds.css
const CHUNK_W = 360;   // .chunk
const GAP_X = 190;     // horizontal run between a card and its chunks

// Where an action's results land relative to the box that produced them.
const RESULT_GAP_X = 250;
const RESULT_GAP_Y = 420;
const RESULT_COUNT = 2;
// Zoom returns three boxes of prose rather than two of quoted passage, so they
// need more room between them than a search result does.
const ZOOM_GAP_Y = 330;
// The fan cascades down and to the right. Kept deliberately tight: source boxes
// are allowed to overlap each other mildly, and an open action panel overlaps
// the box below it outright — the open one is lifted clear with z-index instead
// of the layout being spread out to make room.
const GAP_Y = 305;    // vertical pitch — just under a full box, so they kiss
const STAGGER_X = 56; // each box down the fan also steps right

/**
 * Where the canvas sits on load, and how far it can be zoomed.
 *
 * `zoom: 1` is 1:1 — a 305px card is 305 screen pixels. 0.6 pulls back far
 * enough to hold a card and its whole fanned-out cascade in view; raise it
 * toward 1 to start in closer. x/y shift the origin: positive x moves content
 * right, positive y moves it down.
 *
 * Zoom is clamped to MIN_ZOOM..MAX_ZOOM, so a DEFAULT_ZOOM outside that range
 * gets pinned to the nearest end.
 */
const DEFAULT_ZOOM = 0.6;
const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: DEFAULT_ZOOM };
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2.5;

/**
 * The moves offered on a source box.
 *
 * Each one's behaviour is a separate task — `runAction` below is the single
 * seam where they get wired up. Order here is the order they wrap on screen.
 */
const ACTIONS = [
  { id: 'neighbor', label: 'Find a neighbor', color: '#efa8f2' },
  { id: 'compare', label: 'Compare this', color: '#c3a4f7' },
  { id: 'counter', label: 'Counterexample', color: '#a5f0b5' },
  { id: 'zoom-in', label: 'Zoom in', color: '#ef9a3e' },
  { id: 'zoom-out', label: 'Zoom out', color: '#e8f53f' },
  { id: 'evidence', label: 'Find evidence', color: '#77c7f2' },
];

const actionById = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));

// Zoom in runs three model calls and a web search, so it says what it's doing.
const BUSY_LABEL = { 'zoom-in': 'Zooming…' };

/**
 * Actions answered by a cosine search over the vector DB.
 *
 * Both read the same cosine ranking from opposite ends: `near` returns the
 * closest passages, `far` the farthest. See data.js for where they come from.
 */
const VECTOR_SEARCHES = {
  neighbor: { direction: 'near', noun: 'Neighbor' },
  counter: { direction: 'far', noun: 'Counterexample' },
};

// Ids for spawned nodes. A counter rather than the node count, so repeated
// clicks can't collide after something has been removed.
let spawnSeq = 0;

/** The × that sits on a box's top-right corner. Shared by every box type. */
function CloseButton({ onClick }) {
  return (
    <button className="box-close nodrag" onClick={onClick} title="Remove" aria-label="Remove">
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/** An edge carrying the pill of the action that created it. */
function actionEdge(source, target, action) {
  const { label, color } = actionById[action] || { label: action, color: '#fff' };
  return {
    id: `edge-${target}`,
    source,
    target,
    type: 'bezier',
    label,
    labelShowBg: true,
    labelBgPadding: [11, 6],
    labelBgBorderRadius: 999,
    labelBgStyle: { fill: color, stroke: '#000', strokeWidth: 1.5 },
    labelStyle: { fill: '#000', fontWeight: 600, fontSize: 13 },
    style: { stroke: '#000', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#000', width: 16, height: 16 },
  };
}

/**
 * A node's id plus every node descended from it, via `data.parentId`.
 *
 * Results can now spawn results, so removing a box has to take the whole
 * subtree rather than just its direct children.
 */
function useRemoveSubtree(id) {
  const { getNodes, setNodes, setEdges } = useReactFlow();

  return (event) => {
    event?.stopPropagation();

    // Computed from getNodes() rather than inside the setNodes updater: a
    // state updater must stay pure, and React may run it more than once.
    const doomed = withDescendants(getNodes(), id);
    setNodes((ns) => ns.filter((n) => !doomed.has(n.id)));
    setEdges((es) => es.filter((e) => !doomed.has(e.source) && !doomed.has(e.target)));
  };
}

function withDescendants(nodes, rootId) {
  const doomed = new Set([rootId]);
  let grew = true;

  while (grew) {
    grew = false;
    for (const node of nodes) {
      if (!doomed.has(node.id) && doomed.has(node.data?.parentId)) {
        doomed.add(node.id);
        grew = true;
      }
    }
  }
  return doomed;
}

// ── Canvas node ───────────────────────────────────────────────────────────────

function Chevron({ up }) {
  return (
    <svg className={`chev${up ? ' chev--up' : ''}`} width="11" height="7" viewBox="0 0 11 7" aria-hidden="true">
      <path d="M1 1l4.5 4.5L10 1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A dropped seed.
 *
 * The type size is the same on every card whatever the text length — a long
 * quote grows the card downward rather than shrinking to fit, so a wall of
 * cards reads as one weight. Short text sits at the bottom; long text fills.
 */
function CardNode({ id, data }) {
  const [expanded, setExpanded] = useState(false);

  // Taking a card away takes its chunks, their results, and every edge between.
  const remove = useRemoveSubtree(id);

  return (
    <div className="card-wrap">
      <div className="card">
        <p className="card-text">{data.text}</p>

        {/* `nowheel` lets the passages scroll without zooming the canvas. */}
        {expanded && (
          <div className="card-sources nowheel nodrag">
            {data.sources || 'No sources recorded for this provocation.'}
          </div>
        )}
      </div>

      {/* `nodrag` keeps a click on these from panning the node underneath. */}
      <CloseButton onClick={remove} />

      <button
        className={`card-expand nodrag${expanded ? ' is-open' : ''}`}
        onClick={(event) => {
          event.stopPropagation();
          setExpanded((v) => !v);
        }}
      >
        {expanded ? 'Collapse' : 'Expand'}
        <Chevron up={expanded} />
      </button>

      {/* Anchor for the edges out to this card's chunks. Styled invisible. */}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

// ── Chunk node ────────────────────────────────────────────────────────────────

function FileIcon() {
  return (
    <svg width="11" height="13" viewBox="0 0 11 13" fill="none" aria-hidden="true">
      <path d="M6.5.5H1.5v12h8V3.5L6.5.5zM6.5.5v3h3" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="5.2" stroke="currentColor" strokeWidth="1" />
      <path d="M.8 6h10.4M6 .8c1.6 1.6 1.6 8.8 0 10.4M6 .8C4.4 2.4 4.4 9.6 6 11.2" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

/**
 * One retrieved passage from the sources column.
 *
 * Clicking the box opens the action pills beneath it; clicking it again closes
 * them.
 */
function ChunkNode({ id, data }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const { setNodes, setEdges, getNode } = useReactFlow();
  const remove = useRemoveSubtree(id);

  /** Drop `results` onto the canvas to the right, joined by labelled edges. */
  const spawn = (action, results, gapY = RESULT_GAP_Y) => {
    const self = getNode(id);
    if (!self) return;

    const centreY = self.position.y + (self.measured?.height ?? 300) / 2;
    const x = self.position.x + CHUNK_W + RESULT_GAP_X;

    const nodes = results.map((result, i) => ({
      id: `${id}-${action}-${spawnSeq++}`,
      type: 'chunk',
      position: {
        x,
        y: centreY + (i - (results.length - 1) / 2) * gapY - 150,
      },
      data: { ...result, parentId: id },
    }));

    setNodes((ns) => ns.concat(nodes));
    setEdges((es) => es.concat(nodes.map((n) => actionEdge(id, n.id, action))));
  };

  /**
   * Search the cosine ranking and hang the results off this box.
   *
   * Never the pre-computed `sources` column — this is the vector DB, either
   * queried live or read from the exported index. See data.js.
   */
  const search = async (action) => {
    const { direction, noun } = VECTOR_SEARCHES[action];

    const results = await searchPassage(data.text, direction, RESULT_COUNT);
    if (!results.length) throw new Error('No other passages came back.');

    spawn(action, results.map((r, i) => ({
      title: `${noun} ${i + 1} · ${Math.round(r.similarity * 100)}% similar`,
      text: r.text,
      file: r.file,
      url: null,
    })));
  };

  /**
   * Zoom in — the agentic move.
   *
   * Gemini decides what to look up, the vector DB answers the corpus half, and a
   * grounded web search answers the rest. Three boxes come back: two from the
   * corpus, one from the web, each a short summary with whatever links it found.
   * See zoom.js for the pipeline and data.js for which end it's read from.
   */
  const zoom = async () => {
    const boxes = await zoomIn(data.text);

    spawn('zoom-in', boxes.map((box) => ({
      title: box.title,
      text: box.summary,
      links: box.links || [],
      note: box.grounded === false
        ? 'The web search returned no sources, so this is the model answering from '
          + 'memory — treat the names and dates in it as unchecked.'
        : null,
      file: box.kind === 'corpus' ? data.file : null,
      url: null,
    })), ZOOM_GAP_Y);
  };

  /**
   * Every pill and the ask box lands here.
   *
   * Three moves are wired up — the two cosine searches and Zoom in. The rest are
   * still placeholders awaiting their own task. `action` is an ACTIONS id or
   * 'ask', and `payload` carries the typed question for 'ask'.
   */
  const runAction = async (action, payload) => {
    if (busy) return;
    setError(null);

    const run = VECTOR_SEARCHES[action] ? () => search(action)
              : action === 'zoom-in'    ? zoom
              : null;

    if (!run) {
      void payload;
      return;
    }

    setBusy(action);
    try {
      await run();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const ask = (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const q = question.trim();
    if (!q) return;
    runAction('ask', q);
    setQuestion('');
  };

  return (
    <div className={`chunk-wrap${open ? ' chunk-wrap--open' : ''}`}>
      <div className="chunk" onClick={() => setOpen((v) => !v)}>
        {/* Incoming from whatever produced this box, and outgoing to the
            results its own action pills spawn. Both styled invisible. */}
        <Handle type="target" position={Position.Left} />
        <Handle type="source" position={Position.Right} />

        <h3 className="chunk-title">{data.title}</h3>
        <p className={`chunk-body nowheel nodrag${data.links ? ' chunk-body--prose' : ''}`}>
          {data.text}
        </p>

        {/* Zoom boxes say where they couldn't reach, rather than implying they did. */}
        {data.note && <p className="chunk-note">{data.note}</p>}

        <div className="chunk-chips">
          {data.file && (
            <span className="chip" title={data.file}>
              <FileIcon /> Source
            </span>
          )}

          {/* A few passages quote a link inline; only then is there a web source. */}
          {data.url && (
            <a
              className="chip chip--web nodrag"
              href={data.url}
              target="_blank"
              rel="noreferrer"
              title={data.url}
              onClick={(event) => event.stopPropagation()}
            >
              <GlobeIcon /> Source
            </a>
          )}

          {/* Zoom's own citations — the web box's sources, or a URL a passage quotes. */}
          {(data.links || []).map((link) => (
            <a
              key={link.url}
              className="chip chip--web nodrag"
              href={link.url}
              target="_blank"
              rel="noreferrer"
              title={link.url}
              onClick={(event) => event.stopPropagation()}
            >
              <GlobeIcon /> {link.title || 'Link'}
            </a>
          ))}
        </div>
      </div>

      <CloseButton onClick={remove} />

      {open && (
        <div className="chunk-actions nodrag" onClick={(event) => event.stopPropagation()}>
          {ACTIONS.map((action) => (
            <button
              key={action.id}
              className="act"
              style={{ background: action.color }}
              onClick={() => runAction(action.id)}
              disabled={busy !== null}
            >
              {busy === action.id ? BUSY_LABEL[action.id] || 'Searching…' : action.label}
            </button>
          ))}

          <input
            className="act-ask"
            type="text"
            placeholder="Ask your own question…  (press Enter)"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={ask}
          />

          {error && <p className="act-error">{error}</p>}
        </div>
      )}
    </div>
  );
}

// Defined once, outside the component: React Flow re-mounts every node if this
// object identity changes between renders.
const nodeTypes = { card: CardNode, chunk: ChunkNode };

// ── Tray ──────────────────────────────────────────────────────────────────────

function Tray({ seeds, onDragStart, onDragEnd, draggingId }) {
  const [open, setOpen] = useState(true);

  return (
    <div className={`tray${open ? '' : ' tray--collapsed'}`}>
      <div className="tray-head">
        <span className="tray-title">Seeds</span>
        <button
          className="tray-toggle"
          onClick={() => setOpen((v) => !v)}
          title={open ? 'Collapse' : 'Expand'}
        >
          {open ? '−' : '+'}
        </button>
      </div>

      {open && (
        <div className="tray-body nowheel">
          {seeds.length ? (
            seeds.map((seed) => (
              <div
                key={seed.id}
                className={`seed${draggingId === seed.id ? ' seed--dragging' : ''}`}
                draggable
                onDragStart={(e) => onDragStart(e, seed)}
                onDragEnd={onDragEnd}
                title={seed.sources || ''}
              >
                {seed.text}
              </div>
            ))
          ) : (
            <p className="tray-empty">All planted. Reload for another ten.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Canvas ────────────────────────────────────────────────────────────────────

function Canvas({ initialSeeds }) {
  const [seeds, setSeeds] = useState(initialSeeds);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [draggingId, setDraggingId] = useState(null);
  const { screenToFlowPosition } = useReactFlow();
  const nextId = useRef(0);

  const onDragStart = useCallback((event, seed) => {
    // The whole seed rather than its id, so the drop can build a node without
    // reaching back into tray state.
    event.dataTransfer.setData(MIME, JSON.stringify(seed));
    event.dataTransfer.effectAllowed = 'move';
    setDraggingId(seed.id);
  }, []);

  const onDragEnd = useCallback(() => setDraggingId(null), []);

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();

      const raw = event.dataTransfer.getData(MIME);
      if (!raw) return;
      const seed = JSON.parse(raw);

      setNodes((ns) =>
        ns.concat({
          id: `card-${nextId.current++}`,
          type: 'card',
          // The card's top-left lands where the cursor let go.
          position: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
          data: {
            text: seed.text,
            sources: seed.sources,
            file: seed.file,
            passages: seed.passages || [],
          },
        }),
      );

      // A planted seed leaves the tray. Drop this line to let seeds be reused.
      setSeeds((ss) => ss.filter((s) => s.id !== seed.id));
      setDraggingId(null);
    },
    [screenToFlowPosition, setNodes],
  );

  /**
   * Clicking a card fans its retrieved passages out to the right, one chunk
   * card each, joined by curved edges. Clicking it again puts them away.
   */
  const onNodeClick = useCallback(
    (event, node) => {
      if (node.type !== 'card') return;

      const passages = node.data.passages || [];
      if (!passages.length) return;

      if (nodes.some((n) => n.data?.parentId === node.id)) {
        // Chunks may have spawned results of their own — take the subtree.
        const doomed = withDescendants(nodes, node.id);
        doomed.delete(node.id);
        setNodes((ns) => ns.filter((n) => !doomed.has(n.id)));
        setEdges((es) => es.filter((e) => !doomed.has(e.target)));
        return;
      }

      // Fan the chunks around the card's own vertical centre. `measured` is the
      // rendered height, which grows with the text, so this stays centred.
      const centreY = node.position.y + (node.measured?.height ?? 345) / 2;
      const x = node.position.x + CARD_W + GAP_X;

      const chunks = passages.map((passage, i) => ({
        id: `${node.id}-chunk-${i}`,
        type: 'chunk',
        position: {
          x: x + i * STAGGER_X,
          y: centreY + (i - (passages.length - 1) / 2) * GAP_Y - 150,
        },
        data: {
          title: `Source ${i + 1}`,
          text: passage.text,
          url: passage.url,
          file: node.data.file,
          parentId: node.id,
        },
      }));

      setNodes((ns) => ns.concat(chunks));
      setEdges((es) =>
        es.concat(
          chunks.map((chunk) => ({
            id: `edge-${chunk.id}`,
            source: node.id,
            target: chunk.id,
            type: 'bezier',
            style: { stroke: '#000', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#000', width: 16, height: 16 },
          })),
        ),
      );
    },
    [nodes, setNodes, setEdges],
  );

  return (
    <div className="flow" onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        defaultViewport={DEFAULT_VIEWPORT}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        panOnScroll
        selectionOnDrag
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#d7d7d7" />
        <Controls showInteractive={false} position="bottom-left" />
        <Panel position="top-right" style={{ margin: '16px' }}>
          <Tray
            seeds={seeds}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            draggingId={draggingId}
          />
        </Panel>
      </ReactFlow>
    </div>
  );
}

// ── Boot ──────────────────────────────────────────────────────────────────────

function App() {
  const [seeds, setSeeds] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadProvocations(SEED_COUNT)
      .then((rows) => setSeeds(rows.map((p, i) => ({ id: `seed-${i}`, ...p }))))
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <p className="status">
        Could not load provocations ({error}).<br />
        {isStatic ? (
          <>Re-run <code>npm run export:static</code> from <code>js/</code>.</>
        ) : (
          <>Start the server with <code>node rag_web.js serve</code> from <code>js/</code>.</>
        )}
      </p>
    );
  }
  if (!seeds) return <p className="status">Loading provocations…</p>;

  return (
    <ReactFlowProvider>
      <Canvas initialSeeds={seeds} />
    </ReactFlowProvider>
  );
}

createRoot(document.getElementById('root')).render(<App />);
