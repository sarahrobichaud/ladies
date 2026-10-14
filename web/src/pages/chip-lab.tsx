import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router';
import { Chip } from '../components/chip';
import { chipLabel, formatChips } from '../snapshot';

// Tray denominations — classic casino colors via the chip palette tiers.
const TRAY: { value: bigint; tier: number }[] = [
  { value: 1n, tier: 0 },
  { value: 5n, tier: 1 },
  { value: 25n, tier: 2 },
  { value: 100n, tier: 3 },
  { value: 500n, tier: 4 },
  { value: 1000n, tier: 5 },
];

const CHIP_RADIUS = 22; // matches the 44px chips
const SNAP_RADIUS = 30; // drop this close to another chip to stack
const SPAWN_THRESHOLD = 6; // pointer travel before a tray press becomes a drag
const MAX_STACK = 10; // wheel-sizing cap for a uniform stack
const STACK_LIFT = 6; // vertical px between chips rendered in a pile
const PREVIEW_LIFT = 10; // hover preview: how far the upper half rises

type ChipPiece = { id: number; value: bigint; tier: number; x: number; y: number };
type Piece = ChipPiece & { depth: number; pileSize: number };
type Drag = { ids: number[]; pointerId: number; grabX: number; grabY: number };
type Spawn = { value: bigint; tier: number; pointerId: number; startX: number; startY: number };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// The shared kind of a grabbed group, or null when the chips differ —
// only uniform stacks can be sized with the wheel.
function stackKind(group: ChipPiece[]): ChipPiece | null {
  if (group.length === 0) return null;
  const first = group[0];
  return group.every((c) => c.value === first.value && c.tier === first.tier) ? first : null;
}

// Paint depth of each chip within its pile (same position, earlier in the
// array). Chips sharing a position stack visually; the last one dropped
// sits on top — which is also the one a grab picks up, since it paints last.
function withDepths(chips: ChipPiece[]): Piece[] {
  const counts = new Map<string, number>();
  for (const c of chips) {
    const key = `${c.x},${c.y}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const depths = new Map<string, number>();
  return chips.map((c) => {
    const key = `${c.x},${c.y}`;
    const depth = depths.get(key) ?? 0;
    depths.set(key, depth + 1);
    return { ...c, depth, pileSize: counts.get(key) ?? 1 };
  });
}

export function ChipLab() {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const nextId = useRef(1);

  const [chips, setChips] = useState<ChipPiece[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [spawn, setSpawn] = useState<Spawn | null>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);

  // Mirror the gesture state for the native wheel listener, which is
  // registered once and would otherwise see stale closures.
  const gestureRef = useRef<{ drag: Drag | null; chips: ChipPiece[] }>({ drag, chips });
  gestureRef.current = { drag, chips };

  // Wheel while holding a stack sizes it: scroll up adds a chip of the same
  // kind, scroll down strips the top one (never below one chip). Native
  // listener because React's onWheel is passive and can't preventDefault.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      const { drag, chips } = gestureRef.current;
      if (!drag || (e.deltaY === 0)) return;
      e.preventDefault();

      const group = chips.filter((c) => drag.ids.includes(c.id));
      const kind = stackKind(group);
      if (!kind) return; // mixed stack: not sizeable

      if (e.deltaY < 0) {
        if (group.length >= MAX_STACK) return;
        const id = nextId.current++;
        setChips((cs) => [
          ...cs,
          { id, value: kind.value, tier: kind.tier, x: kind.x, y: kind.y },
        ]);
        setDrag({ ...drag, ids: [...drag.ids, id] });
      } else {
        if (group.length <= 1) return;
        const topId = group[group.length - 1].id; // last in paint order = top
        setChips((cs) => cs.filter((c) => c.id !== topId));
        setDrag({ ...drag, ids: drag.ids.filter((i) => i !== topId) });
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // Re-register on MAX_STACK changes so hot reloads don't leave a stale
    // listener enforcing the old limit.
  }, [MAX_STACK]);

  const total = chips.reduce((sum, c) => sum + c.value, 0n);

  // Chips sharing a position form a pile; see withDepths.
  const pieces = withDepths(chips);

  // Hover preview: what a left-drag from the hovered chip would take — the
  // top chip, or the whole upper half when hovering below the top. Suppressed
  // while dragging; no geometry changes on hover so the target can't shift
  // under the cursor.
  const hover = (() => {
    if (hoverId === null || drag) return null;
    const hovered = pieces.find((c) => c.id === hoverId);
    if (!hovered) return null;
    return { hovered, isTop: hovered.depth === hovered.pileSize - 1, cutDepth: hovered.depth };
  })();

  const canvasRect = () => canvasRef.current?.getBoundingClientRect() ?? null;

  // Hover is hit-tested manually against resting geometry (ignoring the
  // preview lift), so the animation can't shift the target under the
  // cursor. The last containing chip in array order is the topmost painted.
  const trackHover = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag || spawn) {
      setHoverId(null);
      return;
    }
    const rect = canvasRect();
    if (!rect) return;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    let found: number | null = null;
    for (const c of pieces) {
      const cy = c.y - c.depth * STACK_LIFT;
      const dx = px - c.x;
      const dy = py - cy;
      if (dx * dx + dy * dy <= CHIP_RADIUS * CHIP_RADIUS) found = c.id;
    }
    setHoverId(found);
  };

  const addChip = (value: bigint, tier: number, x: number, y: number) => {
    const id = nextId.current++;
    setChips((cs) => [...cs, { id, value, tier, x, y }]);
    return id;
  };

  const setSpawnDrag = (id: number, pointerId: number) =>
    setDrag({ ids: [id], pointerId, grabX: 0, grabY: 0 });

  const onPointerDownChip = (chip: Piece) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = canvasRect();
    if (!rect) return;
    // Act on the hover target when one is set: it's hit-tested against
    // resting geometry, matching the preview (the lifted upper half shifts
    // which chip the raw event lands on). Touch has no hover and falls back
    // to the event target.
    const target = hover && !drag ? hover.hovered : chip;
    const pile = withDepths(chips).filter((c) => c.x === target.x && c.y === target.y);
    // Right button takes the whole pile. Left button takes the top chip —
    // or, pressed lower in the stack, the whole upper half at the cut.
    const ids =
      e.button === 2
        ? pile.map((c) => c.id)
        : target.depth === pile.length - 1
          ? [target.id]
          : pile.filter((c) => c.depth >= target.depth).map((c) => c.id);
    // Grab from where the target visually sits, preview lift included, so
    // the taken chips don't jump at grab time.
    const previewLift = (depth: number): number => {
      if (!hover || hover.isTop || depth < hover.cutDepth) return 0;
      return PREVIEW_LIFT;
    };
    const anchorDepth = e.button === 2 ? 0 : target.depth;
    setDrag({
      ids,
      pointerId: e.pointerId,
      grabX: e.clientX - (rect.left + target.x),
      grabY:
        e.clientY -
        (rect.top + target.y - anchorDepth * STACK_LIFT - previewLift(anchorDepth)),
    });
  };

  const onPointerDownTray =
    (value: bigint, tier: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setHoverId(null);
      setSpawn({ value, tier, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY });
    };

  // Shared by tray chips and canvas chips: whoever captured the pointer
  // receives the moves, and the active gesture decides what they mean.
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag && drag.pointerId === e.pointerId) {
      const rect = canvasRect();
      if (!rect) return;
      // No clamping while dragging: the chips follow the pointer past the
      // felt edge (clipped), which is what makes "off the table" readable.
      const x = e.clientX - rect.left - drag.grabX;
      const y = e.clientY - rect.top - drag.grabY;
      setChips((cs) => cs.map((c) => (drag.ids.includes(c.id) ? { ...c, x, y } : c)));
    } else if (spawn && spawn.pointerId === e.pointerId) {
      if (Math.hypot(e.clientX - spawn.startX, e.clientY - spawn.startY) < SPAWN_THRESHOLD) return;
      const rect = canvasRect();
      if (!rect) return;
      const id = addChip(spawn.value, spawn.tier, e.clientX - rect.left, e.clientY - rect.top);
      setSpawn(null);
      setSpawnDrag(id, e.pointerId);
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag && drag.pointerId === e.pointerId) {
      setDrag(null);
      const rect = canvasRect();
      if (!rect) return;
      const overCanvas =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (!overCanvas) {
        // Off the felt = the whole group goes back to the tray.
        setChips((cs) => cs.filter((c) => !drag.ids.includes(c.id)));
        return;
      }
      const me = chips.find((c) => c.id === drag.ids[0]);
      if (!me) return;
      const x = clamp(me.x, CHIP_RADIUS, rect.width - CHIP_RADIUS);
      const y = clamp(me.y, CHIP_RADIUS, rect.height - CHIP_RADIUS);
      // Snap against the whole visual column of a pile (base to top), so a
      // chip taken from a tall stack lands back on it instead of floating
      // above it.
      const near = withDepths(chips).find((o) => {
        if (drag.ids.includes(o.id)) return false;
        const top = o.y - o.depth * STACK_LIFT;
        return (
          Math.abs(o.x - x) < SNAP_RADIUS && y > top - SNAP_RADIUS && y < o.y + SNAP_RADIUS
        );
      });
      if (near) {
        // Merge onto the target pile: the group lands on top, so it moves to
        // the end of the array (paint order) as well as to the position.
        setChips((cs) => {
          const group = cs
            .filter((c) => drag.ids.includes(c.id))
            .map((c) => ({ ...c, x: near.x, y: near.y }));
          const rest = cs.filter((c) => !drag.ids.includes(c.id));
          return [...rest, ...group];
        });
      } else {
        setChips((cs) =>
          cs.map((c) => (drag.ids.includes(c.id) ? { ...c, x, y } : c)),
        );
      }
    } else if (spawn && spawn.pointerId === e.pointerId) {
      setSpawn(null);
      // A press without travel is a click: drop a chip near mid-felt.
      const rect = canvasRect();
      if (!rect) return;
      const x = clamp(
        rect.width / 2 + (Math.random() - 0.5) * 160,
        CHIP_RADIUS,
        rect.width - CHIP_RADIUS,
      );
      const y = clamp(
        rect.height / 2 + (Math.random() - 0.5) * 100,
        CHIP_RADIUS,
        rect.height - CHIP_RADIUS,
      );
      addChip(spawn.value, spawn.tier, x, y);
    }
  };

  const cancelGesture = () => {
    setDrag(null);
    setSpawn(null);
    setHoverId(null);
  };

  const trayChipHandlers = (value: bigint, tier: number) => ({
    onPointerDown: onPointerDownTray(value, tier),
    onPointerMove,
    onPointerUp,
    onPointerCancel: cancelGesture,
  });

  return (
    <div className="flex h-dvh flex-col gap-4 bg-canvas p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg text-ink">Chip lab</h1>
          <p className="text-sm text-muted">
            No rules here — drag chips around, build stacks, take them off the table.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <p className="text-sm tabular-nums text-muted">On the table: {formatChips(total)}</p>
          <button
            type="button"
            className="rounded-md border border-line bg-raised px-3 py-1.5 text-sm text-ink hover:bg-blue-tint"
            onClick={() => setChips([])}
          >
            Clear table
          </button>
          <Link to="/" className="text-sm text-orange hover:text-orange-strong">
            Back
          </Link>
        </div>
      </header>

      {/* Specimen strip: every palette tier, for component reference */}
      <div className="flex items-center gap-4 rounded-xl border border-line bg-surface p-3 shadow-lg">
        {TRAY.map(({ value, tier }) => (
          <div key={tier} className="flex flex-col items-center gap-1">
            <Chip value={value} tier={tier} size={44} />
            <span className="text-[10px] text-muted">{chipLabel(value)}</span>
          </div>
        ))}
        <p className="ml-auto max-w-56 text-xs leading-relaxed text-muted">
          Press a tray chip to place one, or drag it straight onto the felt. Drop a chip on
          another to stack it; drop it off the felt to take it back. Right-click drag carries a
          whole stack; scroll while holding one to size it (max 10). Hover a stack to preview the
          grab: the top chip rings, or lower down the upper half lifts off a dashed chip outline —
          drag to take it.
        </p>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Chip tray */}
        <div className="flex w-36 shrink-0 flex-col gap-2 rounded-xl border border-line bg-surface p-3 shadow-lg">
          <p className="text-[10px] uppercase tracking-wide text-muted">Tray</p>
          {TRAY.map(({ value, tier }) => (
            <div
              key={tier}
              className="draggable cursor-grab self-start"
              {...trayChipHandlers(value, tier)}
            >
              <Chip value={value} tier={tier} size={44} />
            </div>
          ))}
        </div>

        {/* Felt canvas */}
        <div
          ref={canvasRef}
          onContextMenu={(e) => e.preventDefault()}
          onPointerMove={trackHover}
          onPointerLeave={() => setHoverId(null)}
          className="pov-felt relative min-h-0 flex-1 overflow-hidden rounded-xl border border-line"
        >
          {/* Ghost chip marking the cut plane — painted between the lower
              stack and the lifted upper half (same z as the cut chip, but
              earlier in DOM order) */}
          {hover && !hover.isTop && (
            <div
              className="pointer-events-none absolute rounded-full border-2 border-dashed border-orange bg-orange-tint/20"
              style={{
                left: hover.hovered.x,
                top: hover.hovered.y - hover.cutDepth * STACK_LIFT,
                width: CHIP_RADIUS * 2,
                height: CHIP_RADIUS * 2,
                transform: 'translate(-50%, -50%)',
                zIndex: 10 + hover.cutDepth,
              }}
            />
          )}

          {pieces.map((chip) => {
            const dragging = drag?.ids.includes(chip.id) ?? false;
            // Hover preview, scoped to the hovered pile only: ring the chip
            // a left-drag takes (top), or lift and brighten the upper half a
            // lower grab would split off.
            const inHoverPile =
              hover !== null && chip.x === hover.hovered.x && chip.y === hover.hovered.y;
            const cutChip =
              hover !== null && !hover.isTop && inHoverPile && chip.depth >= hover.cutDepth;
            const topHover = hover !== null && hover.isTop && chip.id === hover.hovered.id;
            const lift = cutChip ? PREVIEW_LIFT : 0;
            const chipClass = dragging
              ? 'brightness-110'
              : topHover
                ? 'ring-2 ring-blue brightness-110'
                : cutChip
                  ? 'brightness-125'
                  : undefined;
            return (
              <div
                key={chip.id}
                className={`draggable absolute ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                style={{
                  left: chip.x,
                  top: chip.y - chip.depth * STACK_LIFT - lift,
                  transform: 'translate(-50%, -50%)',
                  zIndex: dragging ? 50 : 10 + chip.depth,
                  transition: dragging ? 'none' : 'left 160ms ease, top 160ms ease',
                }}
                onPointerDown={onPointerDownChip(chip)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={cancelGesture}
              >
                <Chip value={chip.value} tier={chip.tier} size={44} className={chipClass} />
              </div>
            );
          })}

          {/* Floating capacity + value indicator beside the grabbed stack */}
          {drag &&
            (() => {
              const group = chips.filter((c) => drag.ids.includes(c.id));
              const kind = stackKind(group);
              if (group.length === 0) return null;
              const anchor = group[0];
              const groupTotal = group.reduce((sum, c) => sum + c.value, 0n);
              return (
                <div
                  className="pointer-events-none absolute z-40 flex -translate-y-1/2 items-center gap-1.5 rounded-full border border-line bg-canvas/90 px-2 py-0.5 text-xs font-semibold tabular-nums shadow"
                  style={{ left: anchor.x + 34, top: anchor.y - 22 }}
                >
                  {kind ? (
                    <span className={group.length >= MAX_STACK ? 'text-orange-strong' : 'text-ink'}>
                      {group.length} / {MAX_STACK}
                    </span>
                  ) : (
                    <span className="text-muted">{group.length} · mixed</span>
                  )}
                  <span className="text-muted">·</span>
                  <span className="text-ink">{formatChips(groupTotal)}</span>
                </div>
              );
            })()}

          {chips.length === 0 && (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-on-felt/50">
              Empty felt — add chips from the tray
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
