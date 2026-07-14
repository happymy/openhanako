import { RangeSetBuilder, StateEffect, StateField, Transaction, type EditorState } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import {
  buildMarkdownBlockMove,
  collectMarkdownBlocks,
  type MarkdownBlock,
  type MarkdownBlockPlacement,
} from './markdown-blocks';

export type MarkdownBlockMenuTarget = MarkdownBlock;

export interface MarkdownBlockMenuRequest {
  readonly id: number;
  readonly position: { x: number; y: number };
  readonly target: MarkdownBlockMenuTarget;
}

interface MarkdownBlockHandleOptions {
  readonly readOnly?: boolean;
  readonly onOpenMenu: (request: MarkdownBlockMenuRequest) => void;
}

const HANDLE_SIZE = 24;
const HANDLE_GAP = 4;
const HANDLE_RAIL_WIDTH = HANDLE_SIZE + HANDLE_GAP;
const DRAG_THRESHOLD = 4;

interface DragHighlightRange {
  readonly from: number;
  readonly to: number;
}

interface DragHighlightState {
  readonly source: DragHighlightRange | null;
  readonly target: DragHighlightRange | null;
}

const setDragHighlightEffect = StateEffect.define<DragHighlightState>();

function buildDragHighlightDecorations(
  state: EditorState,
  highlight: DragHighlightState,
): DecorationSet {
  const entries: Array<{ position: number; decoration: Decoration }> = [];
  const addRange = (range: DragHighlightRange | null, className: string) => {
    if (!range || range.from < 0 || range.to <= range.from || range.from > state.doc.length) return;
    const startLine = state.doc.lineAt(Math.min(range.from, state.doc.length));
    const endLine = state.doc.lineAt(Math.min(range.to - 1, state.doc.length));
    for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber += 1) {
      const line = state.doc.line(lineNumber);
      const classes = [className];
      if (lineNumber === startLine.number) classes.push(`${className}-first`);
      if (lineNumber === endLine.number) classes.push(`${className}-last`);
      entries.push({
        position: line.from,
        decoration: Decoration.line({ class: classes.join(' ') }),
      });
    }
  };

  addRange(highlight.source, 'cm-markdown-block-drag-source');
  addRange(highlight.target, 'cm-markdown-block-drop-target');
  entries.sort((left, right) => left.position - right.position);

  const builder = new RangeSetBuilder<Decoration>();
  for (const entry of entries) {
    builder.add(entry.position, entry.position, entry.decoration);
  }
  return builder.finish();
}

export const markdownBlockDragHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, transaction) {
    const effect = transaction.effects.find(candidate => candidate.is(setDragHighlightEffect));
    if (effect?.is(setDragHighlightEffect)) {
      return buildDragHighlightDecorations(transaction.state, effect.value);
    }
    return transaction.docChanged ? Decoration.none : value;
  },
  provide: field => EditorView.decorations.from(field),
});

type EditorCoordinates = NonNullable<ReturnType<EditorView['coordsAtPos']>>;

interface MeasuredMarkdownBlock {
  readonly start: EditorCoordinates;
  readonly end: EditorCoordinates;
  readonly left: number;
}

interface MarkdownBlockRailItemLayout {
  readonly block: MarkdownBlock;
  readonly measurement: MeasuredMarkdownBlock;
  readonly left: number;
  readonly top: number;
  readonly height: number;
  readonly handleTop: number;
}

interface MarkdownBlockRailLayout {
  readonly items: MarkdownBlockRailItemLayout[];
}

function lineCoordinates(
  view: EditorView,
  lineNumber: number,
  edge: 'start' | 'end',
): EditorCoordinates | null {
  const line = view.state.doc.line(lineNumber);
  const positions = edge === 'start'
    ? [line.from, line.to]
    : [line.to, line.from];
  const visited = new Set<number>();
  for (const position of positions) {
    if (visited.has(position)) continue;
    visited.add(position);
    const coordinates = view.coordsAtPos(position, edge === 'start' ? 1 : -1);
    if (coordinates) return coordinates;
  }
  return null;
}

function measureMarkdownBlock(view: EditorView, block: MarkdownBlock): MeasuredMarkdownBlock | null {
  let start: EditorCoordinates | null = null;
  let end: EditorCoordinates | null = null;
  let left = Number.POSITIVE_INFINITY;

  for (let lineNumber = block.startLine; lineNumber <= block.endLine; lineNumber += 1) {
    const coordinates = lineCoordinates(view, lineNumber, 'start');
    if (!coordinates) continue;
    start ??= coordinates;
    left = Math.min(left, coordinates.left);
  }
  for (let lineNumber = block.endLine; lineNumber >= block.startLine; lineNumber -= 1) {
    end = lineCoordinates(view, lineNumber, 'end');
    if (end) break;
  }

  return start && end && Number.isFinite(left) ? { start, end, left } : null;
}

function blockMatches(left: MarkdownBlock, right: MarkdownBlock): boolean {
  return left.from === right.from
    && left.to === right.to
    && left.type === right.type
    && left.source === right.source;
}

function blockAtCurrentPosition(view: EditorView, candidate: MarkdownBlock): MarkdownBlock | null {
  return collectMarkdownBlocks(view.state).find(block => blockMatches(block, candidate)) ?? null;
}

function translation(ownerWindow: Window, key: string, fallback: string): string {
  const translated = ownerWindow.t?.(key);
  return translated && translated !== key ? translated : fallback;
}

function createGripIcon(doc: Document): SVGSVGElement {
  const icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 14 14');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('stroke-linecap', 'round');

  for (const x of [4, 10]) {
    for (const y of [3, 7, 11]) {
      const dot = doc.createElementNS('http://www.w3.org/2000/svg', 'line');
      dot.setAttribute('x1', String(x));
      dot.setAttribute('x2', String(x));
      dot.setAttribute('y1', String(y));
      dot.setAttribute('y2', String(y));
      icon.appendChild(dot);
    }
  }
  return icon;
}

class MarkdownBlockHandleView {
  private readonly rail: HTMLDivElement;
  private readonly dropIndicator: HTMLDivElement;
  private readonly ownerWindow: Window;
  private measuredBlocks: Array<{
    block: MarkdownBlock;
    measurement: MeasuredMarkdownBlock;
  }> = [];
  private draggedBlock: MarkdownBlock | null = null;
  private dropTarget: { block: MarkdownBlock; placement: MarkdownBlockPlacement } | null = null;
  private pendingDrag: {
    block: MarkdownBlock;
    button: HTMLButtonElement;
    pointerId: number;
    startY: number;
  } | null = null;
  private suppressClick = false;
  private frameId: number | null = null;
  private requestId = 0;

  constructor(
    private readonly view: EditorView,
    private readonly options: MarkdownBlockHandleOptions,
  ) {
    const doc = view.dom.ownerDocument;
    this.ownerWindow = doc.defaultView ?? window;
    this.rail = doc.createElement('div');
    this.rail.className = 'cm-markdown-block-rail';
    this.rail.setAttribute('aria-hidden', options.readOnly ? 'true' : 'false');

    this.dropIndicator = doc.createElement('div');
    this.dropIndicator.className = 'cm-markdown-block-drop-indicator';
    this.dropIndicator.hidden = true;

    view.dom.append(this.rail, this.dropIndicator);
    view.scrollDOM.addEventListener('scroll', this.scheduleRender, { passive: true });
    this.ownerWindow.addEventListener('resize', this.scheduleRender);
    this.scheduleRender();
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged || update.geometryChanged) {
      this.scheduleRender();
    }
  }

  destroy(): void {
    if (this.frameId !== null) this.ownerWindow.cancelAnimationFrame(this.frameId);
    this.view.scrollDOM.removeEventListener('scroll', this.scheduleRender);
    this.ownerWindow.removeEventListener('resize', this.scheduleRender);
    this.rail.remove();
    this.dropIndicator.remove();
  }

  private readonly scheduleRender = (): void => {
    if (this.frameId !== null) return;
    this.frameId = this.ownerWindow.requestAnimationFrame(() => {
      this.frameId = null;
      const layout = this.readLayout();
      if (layout) this.render(layout);
    });
  };

  private readLayout(): MarkdownBlockRailLayout | null {
    if (this.pendingDrag) return null;
    const blocks = collectMarkdownBlocks(this.view.state);
    if (this.options.readOnly || blocks.length === 0) return { items: [] };
    const editorRect = this.view.dom.getBoundingClientRect();
    const visibleBlocks = blocks.filter(block => (
      block.to >= this.view.viewport.from && block.from <= this.view.viewport.to
    ));
    const items: MarkdownBlockRailItemLayout[] = [];

    for (const block of visibleBlocks) {
      const measurement = measureMarkdownBlock(this.view, block);
      if (!measurement) continue;
      const { start, end, left } = measurement;
      items.push({
        block,
        measurement,
        left: Math.max(HANDLE_GAP, left - editorRect.left - HANDLE_RAIL_WIDTH),
        top: start.top - editorRect.top,
        height: Math.max(HANDLE_SIZE, end.bottom - start.top),
        handleTop: Math.max(0, (start.bottom - start.top - HANDLE_SIZE) / 2),
      });
    }
    return { items };
  }

  private render(layout: MarkdownBlockRailLayout): void {
    if (this.pendingDrag) return;
    this.measuredBlocks = layout.items.map(({ block, measurement }) => ({ block, measurement }));
    this.rail.replaceChildren();
    if (this.options.readOnly || layout.items.length === 0) return;

    for (const { block, left, top, height, handleTop } of layout.items) {
      const item = this.view.dom.ownerDocument.createElement('div');
      item.className = 'cm-markdown-block-rail-item';
      item.style.left = `${left}px`;
      item.style.top = `${top}px`;
      item.style.height = `${height}px`;
      item.dataset.blockFrom = String(block.from);

      const button = this.view.dom.ownerDocument.createElement('button');
      const blockActionsLabel = translation(this.ownerWindow, 'ctx.blockActions', 'Block actions');
      button.type = 'button';
      button.className = 'cm-markdown-block-handle';
      button.style.top = `${handleTop}px`;
      button.title = blockActionsLabel;
      button.setAttribute('aria-label', blockActionsLabel);
      button.appendChild(createGripIcon(this.view.dom.ownerDocument));
      button.addEventListener('mousedown', event => {
        event.preventDefault();
        event.stopPropagation();
      });
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (this.suppressClick) return;
        const current = blockAtCurrentPosition(this.view, block);
        if (!current) return;
        const rect = button.getBoundingClientRect();
        this.options.onOpenMenu({
          id: ++this.requestId,
          position: { x: rect.right, y: rect.top },
          target: current,
        });
      });
      button.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        const current = blockAtCurrentPosition(this.view, block);
        if (!current) return;
        if (this.frameId !== null) {
          this.ownerWindow.cancelAnimationFrame(this.frameId);
          this.frameId = null;
        }
        this.pendingDrag = {
          block: current,
          button,
          pointerId: event.pointerId,
          startY: event.clientY,
        };
        button.setPointerCapture?.(event.pointerId);
      });
      button.addEventListener('pointermove', event => {
        const pending = this.pendingDrag;
        if (!pending || pending.pointerId !== event.pointerId) return;
        if (!this.draggedBlock && Math.abs(event.clientY - pending.startY) < DRAG_THRESHOLD) return;
        if (!this.draggedBlock) {
          this.draggedBlock = pending.block;
          pending.button.classList.add('is-dragging');
          this.suppressClick = true;
          this.publishDragHighlights();
        }
        event.preventDefault();
        event.stopPropagation();
        this.updateDropTarget(event.clientY);
      });
      button.addEventListener('pointerup', event => {
        const pending = this.pendingDrag;
        if (!pending || pending.pointerId !== event.pointerId) return;
        if (this.draggedBlock) {
          event.preventDefault();
          event.stopPropagation();
          this.commitDrop();
          this.ownerWindow.setTimeout(() => { this.suppressClick = false; }, 0);
        }
        button.releasePointerCapture?.(event.pointerId);
        pending.button.classList.remove('is-dragging');
        this.pendingDrag = null;
        this.scheduleRender();
      });
      button.addEventListener('pointercancel', event => {
        if (this.pendingDrag?.pointerId !== event.pointerId) return;
        this.pendingDrag.button.classList.remove('is-dragging');
        this.pendingDrag = null;
        this.suppressClick = false;
        this.clearDragState();
        this.scheduleRender();
      });

      item.appendChild(button);
      this.rail.appendChild(item);
    }
  }

  private updateDropTarget(clientY: number): void {
    if (!this.draggedBlock) return;
    const draggedBlock = this.draggedBlock;
    const candidates = this.measuredBlocks.filter(({ block }) => !blockMatches(block, draggedBlock));
    if (candidates.length === 0) return;

    let nextTarget: { block: MarkdownBlock; placement: MarkdownBlockPlacement } = {
      block: candidates[candidates.length - 1].block,
      placement: 'after',
    };
    for (const { block, measurement: { start, end } } of candidates) {
      const midpoint = start.top + ((end.bottom - start.top) / 2);
      if (clientY < midpoint) {
        nextTarget = { block, placement: 'before' };
        break;
      }
      nextTarget = { block, placement: 'after' };
    }
    const targetChanged = !this.dropTarget
      || !blockMatches(this.dropTarget.block, nextTarget.block)
      || this.dropTarget.placement !== nextTarget.placement;
    this.dropTarget = nextTarget;
    if (targetChanged) this.publishDragHighlights();
    this.showDropIndicator(nextTarget.block, nextTarget.placement);
  }

  private commitDrop(): void {
    const source = this.draggedBlock ? blockAtCurrentPosition(this.view, this.draggedBlock) : null;
    const target = this.dropTarget
      ? blockAtCurrentPosition(this.view, this.dropTarget.block)
      : null;
    const placement = this.dropTarget?.placement ?? 'before';
    if (!source || !target) {
      this.clearDragState();
      return;
    }
    const move = buildMarkdownBlockMove(this.view.state, source, target, placement);
    this.clearDragState();
    if (!move) return;

    this.view.dispatch({
      changes: move.changes,
      selection: { anchor: move.selectionAnchor },
      scrollIntoView: true,
      annotations: Transaction.userEvent.of('move.drop'),
    });
    this.view.focus();
  }

  private showDropIndicator(target: MarkdownBlock, placement: MarkdownBlockPlacement): void {
    const editorRect = this.view.dom.getBoundingClientRect();
    const measurement = this.measuredBlocks.find(({ block }) => blockMatches(block, target))?.measurement;
    if (!measurement) return;
    const { start, end, left } = measurement;
    const top = (placement === 'before' ? start.top : end.bottom) - editorRect.top;
    this.dropIndicator.style.left = `${Math.max(0, left - editorRect.left - HANDLE_RAIL_WIDTH)}px`;
    this.dropIndicator.style.top = `${top}px`;
    this.dropIndicator.style.width = `${Math.max(HANDLE_SIZE, editorRect.right - start.left)}px`;
    this.dropIndicator.hidden = false;
  }

  private clearDragState(): void {
    const hadHighlight = Boolean(this.draggedBlock || this.dropTarget);
    this.draggedBlock = null;
    this.dropTarget = null;
    this.dropIndicator.hidden = true;
    if (hadHighlight) {
      this.view.dispatch({
        effects: setDragHighlightEffect.of({ source: null, target: null }),
      });
    }
  }

  private publishDragHighlights(): void {
    const source = this.draggedBlock
      ? { from: this.draggedBlock.from, to: this.draggedBlock.to }
      : null;
    const target = this.dropTarget
      ? { from: this.dropTarget.block.from, to: this.dropTarget.block.to }
      : null;
    this.view.dispatch({
      effects: setDragHighlightEffect.of({ source, target }),
    });
  }
}

export function markdownBlockHandlePlugin(options: MarkdownBlockHandleOptions) {
  return [
    markdownBlockDragHighlightField,
    ViewPlugin.define(view => new MarkdownBlockHandleView(view, options)),
  ];
}
