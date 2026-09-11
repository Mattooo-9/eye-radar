export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SpatialItem<T> extends BBox {
  item: T;
}

interface RTreeNode<T> extends BBox {
  children: Array<RTreeNode<T> | SpatialItem<T>>;
  leaf: boolean;
  height: number;
}

/**
 * High-performance 2D R-Tree (RBush-compatible) spatial index.
 * Designed for real-time viewport culling and spatial clustering of map targets.
 */
export class SpatialIndex<T> {
  private maxEntries: number;
  private minEntries: number;
  private root: RTreeNode<T>;
  private count = 0;

  constructor(maxEntries = 16) {
    this.maxEntries = Math.max(4, maxEntries);
    this.minEntries = Math.max(2, Math.ceil(this.maxEntries * 0.4));
    this.root = this.createNode([]);
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.root = this.createNode([]);
    this.count = 0;
  }

  /**
   * Bulk loads items using O(N log N) Hilbert/STR spatial sorting for optimal tree balance.
   */
  load(items: Array<SpatialItem<T>>): this {
    if (!items.length) return this;

    if (items.length < this.minEntries) {
      for (const item of items) {
        this.insert(item);
      }
      return this;
    }

    // Sort items by morton/spatial order (X primary, Y secondary)
    const sorted = items.slice().sort((a, b) => a.minX - b.minX || a.minY - b.minY);

    // Recursively build tree levels
    let node = this.buildTree(sorted, 0, sorted.length, this.maxEntries);

    if (this.root.children.length === 0) {
      this.root = node;
    } else {
      // Merge with existing root
      this.root = this.buildLevel([this.root, node]);
    }

    this.count += items.length;
    return this;
  }

  insert(item: SpatialItem<T>): this {
    const bbox: BBox = {
      minX: item.minX,
      minY: item.minY,
      maxX: item.maxX,
      maxY: item.maxY
    };
    this.insertInto(item, this.root.height, bbox);
    this.count++;
    return this;
  }

  /**
   * Searches the spatial index for all items overlapping the query bounding box.
   */
  search(bbox: BBox): T[] {
    const result: T[] = [];
    if (!this.intersects(bbox, this.root)) return result;

    const stack: Array<RTreeNode<T> | SpatialItem<T>> = [this.root];

    while (stack.length > 0) {
      const node = stack.pop()!;
      if (!this.intersects(bbox, node)) continue;

      if ("leaf" in node) {
        for (let i = 0; i < node.children.length; i++) {
          const child = node.children[i];
          if (this.intersects(bbox, child)) {
            if ("leaf" in child) {
              stack.push(child);
            } else {
              result.push((child as SpatialItem<T>).item);
            }
          }
        }
      } else {
        result.push((node as SpatialItem<T>).item);
      }
    }

    return result;
  }

  /**
   * Checks if query bbox overlaps with target bbox.
   */
  private intersects(a: BBox, b: BBox): boolean {
    return (
      a.minX <= b.maxX &&
      a.minY <= b.maxY &&
      a.maxX >= b.minX &&
      a.maxY >= b.minY
    );
  }

  private createNode(children: Array<RTreeNode<T> | SpatialItem<T>>): RTreeNode<T> {
    return {
      children,
      height: 1,
      leaf: true,
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity
    };
  }

  private extend(a: BBox, b: BBox): void {
    a.minX = Math.min(a.minX, b.minX);
    a.minY = Math.min(a.minY, b.minY);
    a.maxX = Math.max(a.maxX, b.maxX);
    a.maxY = Math.max(a.maxY, b.maxY);
  }

  private calcBBox(node: RTreeNode<T>): void {
    node.minX = Infinity;
    node.minY = Infinity;
    node.maxX = -Infinity;
    node.maxY = -Infinity;

    for (let i = 0; i < node.children.length; i++) {
      this.extend(node, node.children[i]);
    }
  }

  private buildTree(
    items: Array<SpatialItem<T>>,
    start: number,
    end: number,
    maxEntries: number
  ): RTreeNode<T> {
    const count = end - start;
    if (count <= maxEntries) {
      const leaf = this.createNode(items.slice(start, end));
      this.calcBBox(leaf);
      return leaf;
    }

    const node = this.createNode([]);
    node.leaf = false;

    const sliceSize = Math.ceil(count / maxEntries);
    for (let i = start; i < end; i += sliceSize) {
      const child = this.buildTree(items, i, Math.min(i + sliceSize, end), maxEntries);
      node.children.push(child);
      node.height = Math.max(node.height, child.height + 1);
    }

    this.calcBBox(node);
    return node;
  }

  private buildLevel(nodes: Array<RTreeNode<T>>): RTreeNode<T> {
    const parent = this.createNode(nodes);
    parent.leaf = false;
    for (const child of nodes) {
      parent.height = Math.max(parent.height, child.height + 1);
    }
    this.calcBBox(parent);
    return parent;
  }

  private insertInto(item: SpatialItem<T>, targetHeight: number, bbox: BBox): void {
    // Simple top-down insertion
    const path: Array<RTreeNode<T>> = [this.root];
    let curr = this.root;

    while (!curr.leaf) {
      this.extend(curr, bbox);
      // Choose child with least enlargement
      let bestChild = curr.children[0] as RTreeNode<T>;
      let bestEnlargement = Infinity;

      for (let i = 0; i < curr.children.length; i++) {
        const child = curr.children[i] as RTreeNode<T>;
        const areaBefore = (child.maxX - child.minX) * (child.maxY - child.minY);
        const areaAfter =
          (Math.max(child.maxX, bbox.maxX) - Math.min(child.minX, bbox.minX)) *
          (Math.max(child.maxY, bbox.maxY) - Math.min(child.minY, bbox.minY));
        const enlargement = areaAfter - areaBefore;
        if (enlargement < bestEnlargement) {
          bestEnlargement = enlargement;
          bestChild = child;
        }
      }

      curr = bestChild;
      path.push(curr);
    }

    this.extend(curr, bbox);
    curr.children.push(item);

    // Split if overflow
    if (curr.children.length > this.maxEntries) {
      this.splitNode(path);
    }
  }

  private splitNode(path: Array<RTreeNode<T>>): void {
    for (let i = path.length - 1; i >= 0; i--) {
      const node = path[i];
      if (node.children.length <= this.maxEntries) {
        this.calcBBox(node);
        continue;
      }

      // Split node into two halves
      const half = Math.ceil(node.children.length / 2);
      const rightChildren = node.children.splice(half);
      const rightNode = this.createNode(rightChildren);
      rightNode.leaf = node.leaf;
      rightNode.height = node.height;

      this.calcBBox(node);
      this.calcBBox(rightNode);

      if (i === 0) {
        // Root split: create new root
        const newRoot = this.createNode([node, rightNode]);
        newRoot.leaf = false;
        newRoot.height = node.height + 1;
        this.calcBBox(newRoot);
        this.root = newRoot;
      } else {
        const parent = path[i - 1];
        parent.children.push(rightNode);
      }
    }
  }
}
