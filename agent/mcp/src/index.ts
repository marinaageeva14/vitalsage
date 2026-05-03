#!/usr/bin/env node
/**
 * VitalSage MCP Server
 *
 * Exposes performance tooling to Claude Code (or any MCP client) as 6 tools:
 *
 *   measure_page          — Synthetic run via Playwright, returns CWV + TraceMetrics
 *   analyze_performance   — Run analysis engine over sessions, returns ranked suggestions
 *   get_real_user_data    — Fetch real-user sessions from a running VitalSage server
 *   compare_performance   — Before/after diff for a URL (verifies a fix worked)
 *   audit_route           — Full end-to-end audit: synthetic + real-user + analysis
 *   find_element_in_dom   — DOM inspector: LCP element, blocking scripts, CLS sources
 *
 * Usage (stdio transport, as Claude Code MCP):
 *   node dist/index.cjs
 *
 * Usage (direct HTTP, for testing):
 *   MCP_TRANSPORT=http MCP_PORT=4000 node dist/index.cjs
 */
import { Server }               from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { MeasureInputSchema,     measurePage }         from './tools/measure.js';
import { AnalyzeInputSchema,     analyzePerformance }  from './tools/analyze.js';
import { RealUserInputSchema,    getRealUserData }      from './tools/real-user.js';
import { CompareInputSchema,     comparePerformance }  from './tools/compare.js';
import { AuditInputSchema,       auditRoute }           from './tools/audit.js';
import { DomInputSchema,         findElementInDom }     from './tools/dom.js';

// ── Tool definitions ────────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name:        'measure_page',
    description: [
      'Run synthetic Playwright measurements against a URL.',
      'Returns Core Web Vitals (LCP, CLS, INP, TTFB, FCP) and optional CPU trace.',
      'Use this to get a performance baseline before making code changes,',
      'and again after to verify improvements.',
    ].join(' '),
    inputSchema: zodToJsonSchema(MeasureInputSchema) as Tool['inputSchema'],
  },
  {
    name:        'analyze_performance',
    description: [
      'Run the VitalSage analysis engine over an array of SessionReport objects.',
      'Returns ranked performance suggestions with severity, estimated impact, and effort.',
      'Pass sessions from measure_page or get_real_user_data.',
      'Use minSamples=1 for synthetic sessions (no minimum required).',
    ].join(' '),
    inputSchema: zodToJsonSchema(AnalyzeInputSchema) as Tool['inputSchema'],
  },
  {
    name:        'get_real_user_data',
    description: [
      'Fetch real-user SessionReports from a running VitalSage example server.',
      'Returns session data collected from actual users visiting the site.',
      'Combine with analyze_performance to get production-level findings.',
    ].join(' '),
    inputSchema: zodToJsonSchema(RealUserInputSchema) as Tool['inputSchema'],
  },
  {
    name:        'compare_performance',
    description: [
      'Compare performance before and after a change.',
      'Runs two measurement passes and returns a diff for each Core Web Vital.',
      'Pass a baseline (from a previous measure_page call) to skip the first pass.',
      'Use this to verify that a code change actually improved performance.',
    ].join(' '),
    inputSchema: zodToJsonSchema(CompareInputSchema) as Tool['inputSchema'],
  },
  {
    name:        'audit_route',
    description: [
      'Full end-to-end performance audit for a route.',
      'Runs synthetic measurements, optionally merges real-user data,',
      'and produces a prioritised list of suggestions.',
      'This is the fastest way to get a complete performance picture of a page.',
    ].join(' '),
    inputSchema: zodToJsonSchema(AuditInputSchema) as Tool['inputSchema'],
  },
  {
    name:        'find_element_in_dom',
    description: [
      'Navigate to a URL and extract DOM-level performance intelligence.',
      'Returns: LCP element (tag, src, size, above-fold status),',
      'render-blocking scripts/stylesheets, CLS contributing elements,',
      'images missing lazy-loading, and third-party scripts.',
      'Use this to pinpoint exactly which element or resource to fix.',
    ].join(' '),
    inputSchema: zodToJsonSchema(DomInputSchema) as Tool['inputSchema'],
  },
];

// ── Server setup ─────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'vitalsage-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: unknown;

    switch (name) {
      case 'measure_page': {
        const input = MeasureInputSchema.parse(args);
        result = await measurePage(input);
        break;
      }
      case 'analyze_performance': {
        const input = AnalyzeInputSchema.parse(args);
        result = await analyzePerformance(input);
        break;
      }
      case 'get_real_user_data': {
        const input = RealUserInputSchema.parse(args);
        result = await getRealUserData(input);
        break;
      }
      case 'compare_performance': {
        const input = CompareInputSchema.parse(args);
        result = await comparePerformance(input);
        break;
      }
      case 'audit_route': {
        const input = AuditInputSchema.parse(args);
        result = await auditRoute(input);
        break;
      }
      case 'find_element_in_dom': {
        const input = DomInputSchema.parse(args);
        result = await findElementInDom(input);
        break;
      }
      default:
        return {
          content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(result, null, 2),
      }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack   = err instanceof Error ? `\n${err.stack}` : '';
    return {
      content: [{ type: 'text' as const, text: `Error in ${name}: ${message}${stack}` }],
      isError: true,
    };
  }
});

// ── Transport ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[VitalSage MCP] Server running on stdio');
}

main().catch(err => {
  console.error('[VitalSage MCP] Fatal error:', err);
  process.exit(1);
});
