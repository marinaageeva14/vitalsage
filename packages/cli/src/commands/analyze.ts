import { writeFile }           from 'node:fs/promises';
import { AnalysisEngine, loadSessionsFromDir, loadSessionsFromUrl, generateHtmlReport } from 'vitalsage-analysis';
import type { EngineConfig, AIConfig }   from '@vitalsage/types';
import { printSuccess, printError, printInfo, printReport } from '../output/terminal.js';

interface AnalyzeArgs {
  sessions?:     string;
  sessionsUrl?:  string;
  sessionsAuth?: string;
  aiProvider?:   string;
  aiKey?:        string;
  aiModel?:      string;
  format:        'terminal' | 'html' | 'json';
  output?:       string;
  minSamples:    number;
}

export async function runAnalyze(args: AnalyzeArgs): Promise<void> {
  // Load sessions
  let sessions;
  if (args.sessions) {
    printInfo(`Loading sessions from ${args.sessions}...`);
    sessions = await loadSessionsFromDir(args.sessions);
  } else if (args.sessionsUrl) {
    printInfo(`Loading sessions from ${args.sessionsUrl}...`);
    const headers = args.sessionsAuth ? { Authorization: args.sessionsAuth } : undefined;
    sessions = await loadSessionsFromUrl(args.sessionsUrl, headers);
  } else {
    printError('Provide --sessions <dir> or --sessions-url <url>');
    process.exit(1);
  }

  printSuccess(`Loaded ${sessions.length} sessions`);

  if (sessions.length === 0) {
    printError('No valid sessions found');
    process.exit(1);
  }

  // Build engine config
  const aiConfig: AIConfig | undefined =
    args.aiProvider && args.aiKey
      ? {
          provider: args.aiProvider as AIConfig['provider'],
          apiKey:   args.aiKey,
          ...(args.aiModel ? { model: args.aiModel } : {}),
        }
      : undefined;

  const engineConfig: EngineConfig = {
    ...(aiConfig ? { ai: aiConfig } : {}),
  };

  const engine  = new AnalysisEngine(engineConfig);
  const reports = await engine.analyze(sessions, { minSamples: args.minSamples });

  printSuccess(`Grouped into ${reports.length} route(s)`);

  if (args.format === 'terminal' || !args.output) {
    printReport(reports);
  }

  if (args.format === 'html' && args.output) {
    const html = generateHtmlReport(reports);
    await writeFile(args.output, html, 'utf8');
    printSuccess(`HTML report written to ${args.output}`);
  }

  if (args.format === 'json' && args.output) {
    await writeFile(args.output, JSON.stringify(reports, null, 2), 'utf8');
    printSuccess(`JSON report written to ${args.output}`);
  }
}
