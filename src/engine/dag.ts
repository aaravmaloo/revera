import fs from 'node:fs';
import path from 'node:path';

export interface DAGNode {
  name: string;
  version: string;
  isDirect: boolean;
  isProd: boolean;
  depth: number;
  dependents: Set<string>;
  dependencies: Set<string>;

  // Pipeline output fields
  intrinsicRisk: number;
  effectiveRisk: number;
  credibleInterval: [number, number];
  tainted: boolean;
  blastRadius: number;
  worstSubpath?: string[];
  report?: any;
}

export function buildDAG(prodDirect: string[], devDirect: string[], nodeModulesDir: string): Map<string, DAGNode> {
  const dag = new Map<string, DAGNode>();

  function traverse(pkgNames: string[], isProd: boolean, parentName: string | null, depth: number) {
    for (const name of pkgNames) {
      let node = dag.get(name);

      if (!node) {
        // Find installed version
        let version = 'unknown';
        try {
          const pkgJsonPath = path.join(nodeModulesDir, name, 'package.json');
          if (fs.existsSync(pkgJsonPath)) {
            const content = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
            version = content.version || 'unknown';
          }
        } catch {
          // ignore
        }

        node = {
          name,
          version,
          isDirect: depth === 0,
          isProd,
          depth,
          dependents: new Set<string>(),
          dependencies: new Set<string>(),
          intrinsicRisk: 0,
          effectiveRisk: 0,
          credibleInterval: [0, 0],
          tainted: false,
          blastRadius: 0,
        };
        dag.set(name, node);
      }

      if (parentName) {
        node.dependents.add(parentName);
        const parentNode = dag.get(parentName);
        if (parentNode) {
          parentNode.dependencies.add(name);
        }
      }

      // Upgrade to production if reached via a production dependency path
      if (isProd) {
        node.isProd = true;
      }

      // Keep minimum depth
      if (depth < node.depth) {
        node.depth = depth;
      }

      // Read transitive children from package.json in node_modules
      try {
        const pkgJsonPath = path.join(nodeModulesDir, name, 'package.json');
        if (fs.existsSync(pkgJsonPath)) {
          const content = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
          const childDeps = Object.keys(content.dependencies || {});

          // Avoid cyclic dependencies by checking depth
          const currentMeta = dag.get(name);
          if (currentMeta && currentMeta.depth >= depth) {
            traverse(childDeps, isProd, name, depth + 1);
          }
        }
      } catch {
        // ignore
      }
    }
  }

  // Traversal order ensures prod takes precedence over dev
  traverse(prodDirect, true, null, 0);
  traverse(devDirect, false, null, 0);

  return dag;
}

export function getTopologicalOrder(nodes: Map<string, DAGNode>): string[] {
  const visited = new Set<string>();
  const temp = new Set<string>();
  const order: string[] = [];

  function visit(name: string) {
    if (temp.has(name)) {
      // Cyclic dependency! Break cycle
      return;
    }
    if (!visited.has(name)) {
      temp.add(name);
      const node = nodes.get(name);
      if (node) {
        for (const dep of node.dependencies) {
          visit(dep);
        }
      }
      temp.delete(name);
      visited.add(name);
      order.push(name);
    }
  }

  for (const name of nodes.keys()) {
    visit(name);
  }

  return order; // order is leaves to root
}

export function calculateTransitiveDependents(nodes: Map<string, DAGNode>): Map<string, number> {
  const transitiveDepsMap = new Map<string, number>();

  for (const name of nodes.keys()) {
    const visited = new Set<string>();

    function traverse(curr: string) {
      const node = nodes.get(curr);
      if (!node) return;
      for (const parent of node.dependents) {
        if (!visited.has(parent)) {
          visited.add(parent);
          traverse(parent);
        }
      }
    }

    traverse(name);
    transitiveDepsMap.set(name, visited.size);
  }

  return transitiveDepsMap;
}
