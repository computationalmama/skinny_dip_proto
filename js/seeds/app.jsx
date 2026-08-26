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

import '@xyflow/react/dist/style.css';
import './seeds.css';

const SEED_COUNT = 10;
const MIME = 'application/seed';

const CARD_W = 305;   // must track .card-wrap width in seeds.css
const GAP_X = 190;    // horizontal run between a card and its chunks
const GAP_Y = 330;    // vertical pitch of the fan; clears a full-height .chunk

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
  const { setNodes, setEdges } = useReactFlow();

  // Taking a card away takes its chunks and their edges with it.
  const remove = (event) => {
    event.stopPropagation();
    setNodes((ns) => ns.filter((n) => n.id !== id && n.data?.parentId !== id));
    setEdges((es) => es.filter((e) => e.source !== id));
  };

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
      <button className="card-close nodrag" onClick={remove} title="Remove card" aria-label="Remove card">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

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

/** One retrieved passage from the sources column. */
function ChunkNode({ data }) {
  return (
    <div className="chunk">
      <Handle type="target" position={Position.Left} />

      <h3 className="chunk-title">{data.title}</h3>
      <p className="chunk-body nowheel nodrag">{data.text}</p>

      <div className="chunk-chips">
        <span className="chip" title={data.file}>
          <FileIcon /> Source
        </span>

        {/* A few passages quote a link inline; only then is there a web source. */}
        {data.url && (
          <a
            className="chip chip--web nodrag"
            href={data.url}
            target="_blank"
            rel="noreferrer"
            title={data.url}
          >
            <GlobeIcon /> Source
          </a>
        )}
      </div>
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
        setNodes((ns) => ns.filter((n) => n.data?.parentId !== node.id));
        setEdges((es) => es.filter((e) => e.source !== node.id));
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
          x,
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
        minZoom={0.15}
        maxZoom={2.5}
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
    fetch(`/provocations?n=${SEED_COUNT}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((rows) => setSeeds(rows.map((p, i) => ({ id: `seed-${i}`, ...p }))))
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <p className="status">
        Could not load provocations ({error}).<br />
        Start the server with <code>node rag_web.js serve</code> from <code>js/</code>.
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
