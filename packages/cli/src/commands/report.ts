import { readFile, writeFile } from 'node:fs/promises';
import { generateHtmlReport }  from 'vitalsage-analysis';
import type { AnalysisReport } from '@vitalsage/types';
import { printSuccess, printError } from '../output/terminal.js';

interface ReportArgs {
  input:  string;
  output: string;
}

export async function runReport(args: ReportArgs): Promise<void> {
  let reports: AnalysisReport[];
  try {
    const raw = await readFile(args.input, 'utf8');
    const data = JSON.parse(raw) as unknown;
    reports = Array.isArray(data) ? data as AnalysisReport[] : [data as AnalysisReport];
  } catch (err) {
    printError(`Failed to read ${args.input}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const html = generateHtmlReport(reports);

  try {
    await writeFile(args.output, html, 'utf8');
    printSuccess(`HTML report written to ${args.output}`);
  } catch (err) {
    printError(`Failed to write ${args.output}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
