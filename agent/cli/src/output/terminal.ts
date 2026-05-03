import type { AnalysisReport, Suggestion, MetricName, MetricDistribution } from '@vitalsage/types';

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const RED    = '\x1b[31m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const WHITE  = '\x1b[37m';

function color(text: string, c: string): string {
  return `${c}${text}${RESET}`;
}

function ratingColor(rating: string): string {
  if (rating === 'good')                return GREEN;
  if (rating === 'needs-improvement')   return YELLOW;
  if (rating === 'poor')                return RED;
  return DIM;
}

function severityColor(severity: string): string {
  if (severity === 'critical') return RED;
  if (severity === 'warning')  return YELLOW;
  return DIM;
}

function formatMetricValue(name: string, value: number): string {
  if (name === 'CLS') return value.toFixed(3);
  return `${Math.round(value).toLocaleString()}ms`;
}

function hr(char = '━', width = 50): string {
  return color(char.repeat(width), DIM);
}

export function printReport(reports: AnalysisReport[]): void {
  for (const report of reports) {
    printRouteReport(report);
  }
}

function printRouteReport(report: AnalysisReport): void {
  const route = report.route.pattern;
  console.log('');
  console.log(hr());
  console.log(`  ${color('Route:', BOLD)} ${color(route, CYAN)}  ${color(`(${report.sampleSize} sessions · confidence: ${report.confidence})`, DIM)}`);
  console.log(hr());

  // Distributions table
  const dists = Object.entries(report.distributions) as [MetricName, MetricDistribution][];
  if (dists.length > 0) {
    console.log('');
    console.log(`  ${color('Core Web Vitals (p75)', BOLD)}`);
    for (const [name, d] of dists) {
      if (!d) continue;
      const val  = formatMetricValue(name, d.p75);
      const rc   = ratingColor(d.rating);
      const pad  = ' '.repeat(Math.max(0, 6 - name.length));
      console.log(`  ${color(name, BOLD)}${pad}  ${color(val.padStart(10), rc)}  ${color(d.rating, rc)}`);
    }
  }

  // Suggestions grouped by severity
  const critical = report.suggestions.filter(s => s.severity === 'critical');
  const warning  = report.suggestions.filter(s => s.severity === 'warning');
  const info     = report.suggestions.filter(s => s.severity === 'info');

  if (report.suggestions.length === 0) {
    console.log('');
    console.log(`  ${color('No suggestions — metrics are within acceptable ranges', GREEN)}`);
    return;
  }

  if (critical.length > 0) {
    console.log('');
    console.log(`  ${color(`Critical (${critical.length})`, RED)}`);
    console.log(`  ${color('─'.repeat(45), DIM)}`);
    for (const s of critical) printSuggestion(s);
  }

  if (warning.length > 0) {
    console.log('');
    console.log(`  ${color(`Warning (${warning.length})`, YELLOW)}`);
    console.log(`  ${color('─'.repeat(45), DIM)}`);
    for (const s of warning) printSuggestion(s);
  }

  if (info.length > 0) {
    console.log('');
    console.log(`  ${color(`Info (${info.length})`, DIM)}`);
    console.log(`  ${color('─'.repeat(45), DIM)}`);
    for (const s of info) printSuggestion(s);
  }
}

function printSuggestion(s: Suggestion): void {
  const sc = severityColor(s.severity);
  const agentTag = color(`[${s.agent}]`, DIM);
  console.log(`  ${agentTag} ${color(s.title, WHITE)}`);

  const meta: string[] = [
    `Impact: ${s.estimatedImpact}`,
    `Effort: ${s.effort}`,
    `Confidence: ${Math.round(s.confidence * 100)}%`,
  ];
  if (s.affectedPercent !== undefined) {
    meta.push(`${Math.round(s.affectedPercent * 100)}% of sessions`);
  }
  console.log(`  ${color(meta.join(' · '), DIM)}`);

  if (s.codeExample) {
    console.log(`  ${color('→ ' + s.codeExample.after.split('\n')[0], sc)}`);
  }
  console.log('');
}

export function printSuccess(msg: string): void {
  console.log(color(`✓ ${msg}`, GREEN));
}

export function printError(msg: string): void {
  console.error(color(`✗ ${msg}`, RED));
}

export function printWarning(msg: string): void {
  console.warn(color(`⚠ ${msg}`, YELLOW));
}

export function printInfo(msg: string): void {
  console.log(color(`  ${msg}`, DIM));
}
