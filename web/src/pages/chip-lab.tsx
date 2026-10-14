import { Fragment, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router';
import { CHIP_TIERS, Chip } from '../components/chip';
import { CATALOG } from '../chips/catalog';
import { chipLabel } from '../snapshot';
import { CHIP_RADIUS, SLOT_ROW_HEIGHT, SLOT_SPACING, slotPosition } from '../chips/lattice';
import { parseRuns } from '../chips/notation';
import {
  PREVIEW_LIFT,
  STACK_CAPACITY,
  STACK_LIFT,
  landingFor,
  nearestFreeSlot,
  nearestSlotAny,
  pickAt,
  stackSize,
  stackTopOffset,
  type Pick,
} from '../chips/rules';
import {
  clearBoard,
  commitHand,
  createBoard,
  discardHand,
  pickFrom,
  pickStack,
  pickTop,
  runsValue,
  setFelt,
  sizeHand,
  spawnStack,
  takeFromTray,
  totalValue,
} from '../chips/model';
import type { Board, Point, Slot, Stack } from '../chips/types';
import { formatChips } from '../snapshot';

const SPAWN_THRESHOLD = 6; // pointer travel before a tray press becomes a drag

type Drag = { pointerId: number; grabX: number; grabY: number };
type Spawn = { kind: number; pointerId: number; startX: number; startY: number };

// A stack at rest renders as ONE entity — a column of perspective ovals:
// every chip is a 44×28 oval stacked STACK_LIFT apart, painted bottom-up so
// each oval shows only its bottom crescent behind the chip above. The
// segment's exposed top chip renders as a full face (pattern + label); the
// rest render as edge ovals (base color, dark edge dashes, contact shadow).
// The hover cut splits the column into lower/upper segments with a ghost
// chip between them; the upper segment rides the preview lift.
function StackView({
  board,
  stack,
  hover,
  dim,
  highlight,
  onGrab,
}: {
  board: Board;
  stack: Stack;
  hover: Pick | null;
  dim: boolean;
  highlight: boolean;
  onGrab: (e: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const { x, y } = slotPosition(stack.slot);
  const size = stackSize(stack);
  const hovered = hover?.stackId === stack.id ? hover : null;
  const cut = hovered && !hovered.isTop && hovered.depth > 0 ? hovered.depth : null;
  const topHover = hovered?.isTop === true;

  // Depth → kind, for oval coloring.
  const kindAt: number[] = [];
  for (const run of stack.runs) {
    for (let i = 0; i < run.count; i++) kindAt.push(run.kind);
  }

  // Segments: the whole stack at rest; lower/upper halves in a cut preview.
  // Each segment's exposed top chip renders as a full face oval.
  const segments: { start: number; top: number; lifted: boolean }[] =
    cut === null
      ? [{ start: 0, top: size - 1, lifted: false }]
      : [
          { start: 0, top: cut - 1, lifted: false },
          { start: cut, top: size - 1, lifted: true },
        ];

  return (
    <div
      onPointerDown={onGrab}
      className={`absolute ${dim ? 'brightness-50 saturate-50' : ''} ${
        highlight ? 'brightness-110' : ''
      }`}
      style={{
        left: x,
        top: y,
        zIndex: 10,
        transition: 'filter 160ms ease',
      }}
    >
      {segments.map((seg, si) => {
        const lift = seg.lifted ? PREVIEW_LIFT : 0;

        // Chips bottom → top; DOM order = paint order, so each oval covers
        // the one beneath it and only its bottom crescent shows.
        const chips: { depth: number; kind: number; face: boolean }[] = [];
        for (let d = seg.start; d <= seg.top; d++) {
          chips.push({ depth: d, kind: kindAt[d], face: d === seg.top });
        }

        return (
          <Fragment key={si}>
            {si > 0 && (
              <div
                className="pointer-events-none absolute rounded-full border-2 border-dashed border-orange bg-orange-tint/20"
                style={{
                  position: 'absolute',
                  left: -CHIP_RADIUS,
                  top: -((seg.start - 1) * STACK_LIFT) - 14,
                  width: CHIP_RADIUS * 2,
                  height: 28,
                }}
              />
            )}
            <div
              className="absolute"
              style={{
                left: -CHIP_RADIUS,
                top: -(seg.top * STACK_LIFT) - 14,
                transform: `translateY(-${lift}px)`,
                transition: 'transform 160ms ease',
              }}
            >
              {chips.map((chip) => {
                const palette = CHIP_TIERS[chip.kind % CHIP_TIERS.length];
                const top = (seg.top - chip.depth) * STACK_LIFT;
                if (chip.face) {
                  return (
                    <div
                      key={chip.depth}
                      className={`poker-chip absolute ${
                        topHover && chip.depth === size - 1 ? 'ring-2 ring-blue brightness-110' : ''
                      }`}
                      style={
                        {
                          position: 'absolute',
                          zIndex: 0,
                          left: 0,
                          top,
                          width: CHIP_RADIUS * 2,
                          height: 28,
                          fontSize: 11,
                          '--chip-face': palette.face,
                          '--chip-spot': palette.spot,
                        } as CSSProperties
                      }
                    >
                      <span
                        className="relative z-10 font-semibold tabular-nums"
                        style={{ color: palette.text }}
                      >
                        {chipLabel(board.catalog[chip.kind].value)}
                      </span>
                    </div>
                  );
                }
                return (
                  <div
                    key={chip.depth}
                    style={{
                      position: 'absolute',
                      left: 0,
                      top,
                      width: CHIP_RADIUS * 2,
                      height: 28,
                      borderRadius: '50%',
                      // Chip-stack edge: dark dashes (the edge-spot pattern
                      // seen edge-on) over the base color, with a contact
                      // shadow at the crescent's bottom edge.
                      backgroundImage: `
                        radial-gradient(2.5px 2px at 50% 25%, rgb(0 0 0 / 0.5) 0 100%, transparent 100%),
                        linear-gradient(${palette.face}, ${palette.face})
                      `,
                      backgroundSize: `9px 6px, 100% 100%`,
                      backgroundRepeat: 'repeat, no-repeat',
                      boxShadow: 'inset 0 -2px 3px rgb(0 0 0 / 0.4)',
                    }}
                  />
                );
              })}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

export function ChipLab() {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [board, setBoard] = useState<Board>(() => createBoard(CATALOG, { w: 0, h: 0 }));
  const [handPos, setHandPos] = useState<Point | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [spawn, setSpawn] = useState<Spawn | null>(null);
  const [hover, setHover] = useState<Pick | null>(null);
  const [notation, setNotation] = useState('');
  const [notationError, setNotationError] = useState<string | null>(null);

  const canvasRect = () => canvasRef.current?.getBoundingClientRect() ?? null;

  // Wheel sizing reads the gesture state through a ref (native listener,
  // registered once); the capacity/uniformity rules live in the model op,
  // so there is no constant to go stale here.
  const gestureRef = useRef({ drag });
  gestureRef.current = { drag };
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!gestureRef.current.drag || e.deltaY === 0) return;
      e.preventDefault();
      setBoard((b) => sizeHand(b, e.deltaY < 0 ? 1 : -1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Felt size feeds the model (the lattice needs it) — measured, not
  // stored twice.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setBoard((b) => setFelt(b, { w: entry.contentRect.width, h: entry.contentRect.height })),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const total = totalValue(board);

  // Landing: the single authority for preview and commit.
  const landing = board.hand && handPos ? landingFor(board, handPos) : null;
  const mergeTarget =
    landing?.type === 'combine'
      ? (board.stacks.find((s) => s.id === landing.stackId) ?? null)
      : null;

  const cancelGesture = () => {
    setDrag(null);
    setSpawn(null);
    setHover(null);
  };

  // Pointer moves: drag the hand, promote a tray press to a drag, or track
  // hover. Shared by the canvas and the tray chips — whoever holds pointer
  // capture receives the moves.
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag && drag.pointerId === e.pointerId) {
      const rect = canvasRect();
      if (!rect) return;
      setHandPos({ x: e.clientX - rect.left - drag.grabX, y: e.clientY - rect.top - drag.grabY });
      setHover(null);
    } else if (spawn && spawn.pointerId === e.pointerId) {
      if (Math.hypot(e.clientX - spawn.startX, e.clientY - spawn.startY) < SPAWN_THRESHOLD) return;
      const rect = canvasRect();
      if (!rect) return;
      setBoard(takeFromTray(board, spawn.kind));
      setSpawn(null);
      setHandPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      setDrag({ pointerId: e.pointerId, grabX: 0, grabY: 0 });
      setHover(null);
    } else {
      const rect = canvasRect();
      if (!rect) return;
      setHover(pickAt(board, { x: e.clientX - rect.left, y: e.clientY - rect.top }));
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag && drag.pointerId === e.pointerId) {
      setDrag(null);
      const rect = canvasRect();
      if (!rect || !handPos) return;
      const overCanvas =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (!overCanvas) {
        setBoard(discardHand(board));
        setHandPos(null);
        return;
      }
      const landingAt = landingFor(board, handPos);
      const slot: Slot | null =
        landingAt.type === 'none' ? nearestSlotAny(board, handPos.x, handPos.y) : landingAt.slot;
      if (!slot) return;
      setBoard(commitHand(board, slot));
      setHandPos(null);
    } else if (spawn && spawn.pointerId === e.pointerId) {
      setSpawn(null);
      const rect = canvasRect();
      if (!rect) return;
      const slot = nearestFreeSlot(board, rect.width / 2, rect.height / 2);
      if (slot) setBoard(spawnStack(board, [{ kind: spawn.kind, count: 1 }], slot));
    }
  };

  const grabStack =
    (stackId: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      // Capture on the canvas: the picked stack may unmount (e.g. taking
      // its only chip), and the capture must survive that.
      canvasRef.current?.setPointerCapture(e.pointerId);
      const rect = canvasRect();
      if (!rect) return;
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const pick = pickAt(board, point);
      if (!pick || pick.stackId !== stackId) return;
      const stack = board.stacks.find((s) => s.id === stackId);
      if (!stack) return;
      const { x: sx, y: sy } = slotPosition(stack.slot);
      const previewLift =
        hover && hover.stackId === stackId && !hover.isTop ? PREVIEW_LIFT : 0;
      const visual = { x: sx, y: sy - pick.depth * STACK_LIFT - previewLift };
      const next =
        e.button === 2
          ? pickStack(board, stackId)
          : pick.isTop
            ? pickTop(board, stackId)
            : pickFrom(board, stackId, pick.depth);
      if (next === board) return;
      setBoard(next);
      setHover(null);
      setHandPos(visual);
      setDrag({
        pointerId: e.pointerId,
        grabX: e.clientX - (rect.left + visual.x),
        grabY: e.clientY - (rect.top + visual.y),
      });
    };

  const onPointerDownTray =
    (kind: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setHover(null);
      setSpawn({ kind, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY });
    };

  const addNotation = () => {
    try {
      const runs = parseRuns(notation, board.catalog);
      const slot = nearestFreeSlot(board, board.felt.w / 2, board.felt.h / 2);
      if (!slot) {
        setNotationError('the felt is full');
        return;
      }
      setBoard(spawnStack(board, runs, slot));
      setNotation('');
      setNotationError(null);
    } catch (err) {
      setNotationError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex h-dvh flex-col gap-4 bg-canvas p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg text-ink">Chip lab</h1>
          <p className="text-sm text-muted">
            Stacks are compressed entities — grab the top, split lower, wheel-size, combine on
            tops.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm tabular-nums text-muted">On the table: {formatChips(total)}</p>
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              addNotation();
            }}
          >
            <input
              value={notation}
              onChange={(e) => setNotation(e.target.value)}
              placeholder="(500, 5), (25, 6)"
              className="w-44 rounded-md border border-line bg-raised px-2 py-1.5 text-sm text-ink focus:border-blue focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-md border border-line bg-raised px-2.5 py-1.5 text-sm text-ink hover:bg-blue-tint"
            >
              Add
            </button>
          </form>
          <button
            type="button"
            className="rounded-md border border-line bg-raised px-3 py-1.5 text-sm text-ink hover:bg-blue-tint"
            onClick={() => setBoard(clearBoard(board))}
          >
            Clear table
          </button>
          <Link to="/" className="text-sm text-orange hover:text-orange-strong">
            Back
          </Link>
        </div>
      </header>
      {notationError && <p className="text-xs text-orange-strong">{notationError}</p>}

      {/* Specimen strip: every palette tier, for component reference */}
      <div className="flex items-center gap-4 rounded-xl border border-line bg-surface p-3 shadow-lg">
        {board.catalog.map((kind, kindId) => (
          <div key={kindId} className="flex flex-col items-center gap-1">
            <Chip value={kind.value} tier={kind.tier} size={44} />
            <span className="text-[10px] text-muted">{chipLabel(kind.value)}</span>
          </div>
        ))}
        <p className="ml-auto max-w-56 text-xs leading-relaxed text-muted">
          Press a tray chip to place one, or drag it straight onto the felt. Chips land on the
          slots — lower a stack onto another stack's top to combine; occupied slots are skipped,
          and dropping off the felt takes chips back. Right-click carries a whole stack; scroll
          while holding one to size it (max {STACK_CAPACITY}).
        </p>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Chip tray */}
        <div className="flex w-36 shrink-0 flex-col gap-2 rounded-xl border border-line bg-surface p-3 shadow-lg">
          <p className="text-[10px] uppercase tracking-wide text-muted">Tray</p>
          {board.catalog.map((kind, kindId) => (
            <div
              key={kindId}
              className="draggable cursor-grab self-start"
              onPointerDown={onPointerDownTray(kindId)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={cancelGesture}
            >
              <Chip value={kind.value} tier={kind.tier} size={44} />
            </div>
          ))}
        </div>

        {/* Felt canvas */}
        <div
          ref={canvasRef}
          onContextMenu={(e) => e.preventDefault()}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={cancelGesture}
          onPointerLeave={() => setHover(null)}
          className="pov-felt relative min-h-0 flex-1 overflow-hidden rounded-xl border border-line"
        >
          {/* Slot lattice, clipped to where chips can land */}
          {board.felt.w > 0 && (
            <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
              <defs>
                <pattern
                  id="slot-lattice"
                  width={SLOT_SPACING}
                  height={SLOT_ROW_HEIGHT * 2}
                  patternUnits="userSpaceOnUse"
                >
                  <g
                    fill="none"
                    stroke="var(--on-felt)"
                    strokeOpacity="0.16"
                    strokeWidth="1"
                    strokeDasharray="3 5"
                  >
                    <circle cx={0} cy={0} r={CHIP_RADIUS - 1} />
                    <circle cx={SLOT_SPACING} cy={0} r={CHIP_RADIUS - 1} />
                    <circle cx={SLOT_SPACING / 2} cy={SLOT_ROW_HEIGHT} r={CHIP_RADIUS - 1} />
                    <circle cx={0} cy={SLOT_ROW_HEIGHT * 2} r={CHIP_RADIUS - 1} />
                    <circle cx={SLOT_SPACING} cy={SLOT_ROW_HEIGHT * 2} r={CHIP_RADIUS - 1} />
                  </g>
                </pattern>
                <clipPath id="slot-clip">
                  <rect
                    x={CHIP_RADIUS}
                    y={CHIP_RADIUS}
                    width={Math.max(0, board.felt.w - CHIP_RADIUS * 2)}
                    height={Math.max(0, board.felt.h - CHIP_RADIUS * 2)}
                  />
                </clipPath>
              </defs>
              <rect width="100%" height="100%" fill="url(#slot-lattice)" clipPath="url(#slot-clip)" />
            </svg>
          )}

          {/* Landing ghost: where the hand's bottom chip will sit */}
          {landing && landing.type !== 'none' && (
            <div
              className={`pointer-events-none absolute rounded-full border-2 border-dashed ${
                landing.type === 'combine'
                  ? 'border-orange bg-orange-tint/20'
                  : 'border-on-felt/60'
              }`}
              style={{
                left: landing.ring.x,
                top: landing.ring.y,
                width: CHIP_RADIUS * 2,
                height: CHIP_RADIUS * 2,
                transform: 'translate(-50%, -50%)',
                zIndex: 9,
              }}
            />
          )}

          {/* Merge halo: pulses around the stack the hand will combine with */}
          {mergeTarget &&
            (() => {
              const n = stackSize(mergeTarget);
              const { x, y } = slotPosition(mergeTarget.slot);
              return (
                <div
                  className="stack-pulse pointer-events-none absolute rounded-full border-2 border-orange"
                  style={{
                    left: x,
                    top: y - ((n - 1) * STACK_LIFT) / 2,
                    width: CHIP_RADIUS * 2 + 12,
                    height: CHIP_RADIUS * 2 + (n - 1) * STACK_LIFT + 12,
                    zIndex: 9,
                  }}
                />
              );
            })()}

          {/* Stacks — compressed entities */}
          {board.stacks.map((stack) => (
            <StackView
              key={stack.id}
              board={board}
              stack={stack}
              hover={hover}
              dim={drag !== null && mergeTarget?.id !== stack.id}
              highlight={mergeTarget?.id === stack.id}
              onGrab={grabStack(stack.id)}
            />
          ))}

          {/* Hand — materialized individual chips */}
          {board.hand &&
            handPos &&
            board.hand.chips.map((chip, i) => {
              const palette = CHIP_TIERS[chip.kind % CHIP_TIERS.length];
              return (
                <div
                  key={chip.id}
                  className="poker-chip absolute"
                  style={
                    {
                      position: 'absolute',
                      left: handPos.x - CHIP_RADIUS,
                      top: handPos.y - i * STACK_LIFT - 14,
                      width: CHIP_RADIUS * 2,
                      height: 28,
                      fontSize: 11,
                      '--chip-face': palette.face,
                      '--chip-spot': palette.spot,
                      zIndex: 50,
                      transition: 'filter 160ms ease',
                    } as CSSProperties
                  }
                >
                  <span
                    className="relative z-10 font-semibold tabular-nums"
                    style={{ color: palette.text }}
                  >
                    {chipLabel(board.catalog[chip.kind].value)}
                  </span>
                </div>
              );
            })}

          {/* Hovered stack value badge */}
          {hover &&
            (() => {
              const stack = board.stacks.find((s) => s.id === hover.stackId);
              if (!stack) return null;
              const { x, y } = slotPosition(stack.slot);
              const topY = y - stackTopOffset(stack);
              return (
                <div
                  className="pointer-events-none absolute z-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-line bg-canvas/90 px-2 py-0.5 text-xs font-semibold tabular-nums text-ink shadow"
                  style={{ left: x, top: Math.max(14, topY - CHIP_RADIUS - 12) }}
                >
                  {formatChips(runsValue(stack.runs, board.catalog))}
                </div>
              );
            })()}

          {board.stacks.length === 0 && !board.hand && (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-on-felt/50">
              Empty felt — add chips from the tray
            </p>
          )}
        </div>
      </div>
    </div>
  );
}