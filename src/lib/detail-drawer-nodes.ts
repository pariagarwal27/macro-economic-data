import type { UiNode } from "../components/macro-ui-hierarchy";

const EMPTY_DETAIL_NODES: UiNode[] = [];

export function stableDetailNodes(nodes?: UiNode[]): UiNode[] {
  return nodes ?? EMPTY_DETAIL_NODES;
}
