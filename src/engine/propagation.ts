import { DAGNode, getTopologicalOrder, calculateTransitiveDependents } from './dag.js';

export function propagateRisk(dag: Map<string, DAGNode>, decay = 0.8): void {
  // 1. Get topological order: leaves to root
  const order = getTopologicalOrder(dag);

  // Calculate transitive dependents count for blast radius
  const transitiveDepsCount = calculateTransitiveDependents(dag);

  for (const name of order) {
    const node = dag.get(name);
    if (!node) continue;

    // Set transitive dependents count
    const dependentsCount = transitiveDepsCount.get(name) || 0;

    // S3 - P2: combined_child = 1 - product of (1 - child.effective_risk) across children
    let productSafe = 1.0;
    let worstChildName: string | null = null;
    let maxChildRisk = 0;
    let taintedChildName: string | null = null;

    for (const childName of node.dependencies) {
      const child = dag.get(childName);
      if (child) {
        productSafe *= 1 - child.effectiveRisk;
        if (child.effectiveRisk > maxChildRisk) {
          maxChildRisk = child.effectiveRisk;
          worstChildName = childName;
        }
        if (child.tainted) {
          taintedChildName = childName;
        }
      }
    }

    const combined_child = 1 - productSafe;

    // S3 - P3: attenuated = combined_child * (decay ^ depth_delta)
    // depth_delta is 1 for immediate dependency edge
    const attenuated = combined_child * decay;

    // S3 - P4: node.effective_risk = 1 - (1 - intrinsic_risk) * (1 - attenuated)
    node.effectiveRisk = 1 - (1 - node.intrinsicRisk) * (1 - attenuated);

    // S3 - P5: Tainted at self, or inherited from any child?
    if (node.tainted) {
      node.worstSubpath = [node.name];
    } else if (taintedChildName) {
      node.tainted = true;
      const childNode = dag.get(taintedChildName);
      node.worstSubpath = [node.name, ...(childNode?.worstSubpath || [])];

      // S3 - P6: Floor effective_risk at the incident's penalty
      node.effectiveRisk = Math.max(node.effectiveRisk, 0.8);
    } else if (worstChildName) {
      const childNode = dag.get(worstChildName);
      node.worstSubpath = [node.name, ...(childNode?.worstSubpath || [])];
    } else {
      node.worstSubpath = [node.name];
    }

    // S3 - P7: blast_radius = effective_risk * dependents_count
    node.blastRadius = node.effectiveRisk * dependentsCount;

    // Update the final overall score and recommendation in the package report
    if (node.report) {
      node.report.effectiveRisk = node.effectiveRisk;
      node.report.overallScore = Math.round(100 * (1 - node.effectiveRisk));

      // Floor rating penalties for security vulnerabilities or archiving
      if (!node.report.trustIncident && !node.tainted) {
        if (
          node.report.negativeSignals &&
          node.report.negativeSignals.some((s: string) => s.includes('vulnerability'))
        ) {
          node.report.overallScore = Math.max(0, node.report.overallScore - 30);
        }
        if (node.report.negativeSignals && node.report.negativeSignals.some((s: string) => s.includes('Archived'))) {
          node.report.overallScore = Math.max(0, node.report.overallScore - 40);
        }
      }

      node.report.tainted = node.tainted;
      node.report.blastRadius = node.blastRadius;
      node.report.worstSubpath = node.worstSubpath;
      node.report.inheritedRisk = attenuated;

      // Forced override if tainted anywhere
      if (node.tainted) {
        node.report.recommendation = node.report.overallScore >= 70 ? 'Use With Caution' : 'Not Recommended';
        if (taintedChildName) {
          node.report.summary += ` Warning: Inherits risk/taint from dependency ${taintedChildName}.`;
        }
      } else {
        if (node.report.overallScore >= 90) node.report.recommendation = 'Highly Recommended';
        else if (node.report.overallScore >= 75) node.report.recommendation = 'Recommended';
        else if (node.report.overallScore >= 50) node.report.recommendation = 'Caution';
        else node.report.recommendation = 'Not Recommended';
      }
    }
  }
}
