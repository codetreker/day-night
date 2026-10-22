type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid capacity receipt object.');
  return value as ObjectValue;
};
const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error('Invalid capacity receipt array.');
  return value;
};
const duration = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Invalid capacity duration.');
  return value;
};

const integer = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid visible graph count.');
  return value;
};
const validateVisibility = (value: unknown): void => {
  const samples = array(value);
  if (samples.length !== 5) throw new Error('Capacity requires exactly five visible graph samples.');
  for (const [index, raw] of samples.entries()) {
    const sample = object(raw);
    const overviewNodes = integer(sample.overviewNodes); const overviewEdges = integer(sample.overviewEdges);
    const addedNodes = integer(sample.addedNodes); const addedEdges = integer(sample.addedEdges);
    if (sample.repetition !== index || overviewNodes < 1 || overviewNodes > 50 || overviewEdges > 100
      || addedNodes < 1 || addedNodes > 20 || addedEdges < 1
      || integer(sample.expandedNodes) !== overviewNodes + addedNodes || integer(sample.expandedEdges) !== overviewEdges + addedEdges
      || sample.resetNodes !== overviewNodes || sample.resetEdges !== overviewEdges) {
      throw new Error('Visible graph evidence differs from the bounded overview, explicit batch, or reset.');
    }
  }
};

export const validatePerformance = (value: unknown): void => {
  const report = object(value);
  if (report.schemaVersion !== 1 || report.result !== 'passed') throw new Error('Capacity receipt did not pass.');
  const datasets = array(report.datasets);
  const names = new Set<string>();
  if (datasets.length !== 4) throw new Error('Capacity requires all four fixed graph datasets.');
  for (const raw of datasets) {
    const dataset = object(raw);
    if (typeof dataset.scenario !== 'string' || !['capacity-chain', 'capacity-merge', 'capacity-shared', 'capacity-external'].includes(dataset.scenario)
      || names.has(dataset.scenario) || dataset.result !== 'passed' || dataset.nodes !== 1000
      || dataset.edges !== (dataset.scenario === 'capacity-chain' ? 999 : 5000)) {
      throw new Error('Capacity dataset differs from the fixed supported graph.');
    }
    names.add(dataset.scenario);
    duration(dataset.networkMs);
    validateVisibility(dataset.visibility);
    const measurements = array(dataset.measurements);
    if (measurements.length !== 5) throw new Error('Capacity requires exactly five expansion measurements.');
    for (const rawMeasurement of measurements) {
      const measurement = object(rawMeasurement);
      if (duration(measurement.openMs) > 3000 || duration(measurement.detailMs) > 300
        || duration(measurement.zoomMs) > 300 || duration(measurement.panMs) > 300) {
        throw new Error('Capacity measurement exceeded its supported performance gate.');
      }
      duration(measurement.detailNetworkMs);
      duration(measurement.layoutMs);
      duration(measurement.renderMs);
    }
  }
  const limits = object(report.limits);
  for (const [kind, nodes, edges] of [['node', 1001, 0], ['edge', 1000, 5001]] as const) {
    const limit = object(limits[kind]);
    if (limit.status !== 409 || limit.nodeCount !== nodes || limit.edgeCount !== edges
      || limit.maxNodes !== 1000 || limit.maxEdges !== 5000) throw new Error('Capacity rejection receipt is missing or inaccurate.');
  }
};
