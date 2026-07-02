/**
 * fixer.ts
 *
 * Calls the configured AI provider with:
 *   - The top performance problem from the latest audit
 *   - Live DOM findings from inspectDom()
 *   - Source file contents from the --source directory
 *
 * The AI returns structured XML patches (search/replace pairs) that can be
 * applied directly to the source files without a full file rewrite.
 */
import type { Suggestion, AIProvider } from '@vitalsage/types';
import type { DomFindings }            from '../utils/dom.js';
import type { SourceFile }             from '../utils/source.js';
import { parseFixResponse }            from './fix-parser.js';
import type { FilePatch }              from './fix-parser.js';

const FIX_SYSTEM_PROMPT = `
You are a senior web performance engineer who improves Core Web Vitals by making
precise, minimal changes to HTML, CSS, and JavaScript source files.

Rules:
- Output ONLY valid XML matching the schema below. No prose before or after.
- Each <search> must match the file content EXACTLY, character-for-character.
  Copy-paste the relevant fragment from the file contents provided — do not paraphrase.
- Make the minimum change necessary to fix the identified problem. Do not refactor
  or "improve" unrelated code.
- If the fix requires adding a new tag (e.g. <link rel="preload">), place it in the
  correct location in the file and include enough surrounding context in <search>.
- Focus on ONE primary problem per response. Produce 1–3 fixes maximum.
- If no fix can be made with confidence (e.g. the problematic code is not in the
  provided files), output <fixes></fixes> with no children.

Output schema:
<fixes>
  <fix>
    <file>relative/path/to/file.html</file>
    <description>One sentence: what is being changed and why it improves performance</description>
    <search><![CDATA[exact text from the file to find and replace]]></search>
    <replace><![CDATA[the replacement text]]></replace>
  </fix>
</fixes>

CRITICAL: <search> and <replace> content MUST be wrapped in <![CDATA[ ... ]]> —
they contain HTML/JS whose angle brackets would otherwise break the XML.
The <search> text must also be unique within the file: include enough
surrounding context that it matches exactly one location.
`.trim();

export async function generateFixes(
  topSuggestion: Suggestion,
  domFindings:   DomFindings,
  sourceFiles:   SourceFile[],
  ai:            AIProvider,
): Promise<FilePatch[]> {
  const userPrompt = buildFixPrompt(topSuggestion, domFindings, sourceFiles);

  const response = await ai.complete({
    systemPrompt: FIX_SYSTEM_PROMPT,
    userPrompt,
    temperature:  0.1,    // low temp — we want precise, reproducible patches
    maxTokens:    1500,
  });

  return parseFixResponse(response.content);
}

function buildFixPrompt(
  suggestion:  Suggestion,
  dom:         DomFindings,
  sourceFiles: SourceFile[],
): string {
  const lines: string[] = [];

  lines.push('## Performance Problem to Fix');
  lines.push(`Agent: ${suggestion.agent} | Metric: ${suggestion.metric} | Severity: ${suggestion.severity}`);
  lines.push(`Title: ${suggestion.title}`);
  lines.push(`Detail: ${suggestion.detail}`);
  if (suggestion.estimatedImpact) {
    lines.push(`Expected improvement: ${suggestion.estimatedImpact}`);
  }
  if (suggestion.codeExample) {
    lines.push('');
    lines.push('Example fix pattern:');
    lines.push(`  Before: ${suggestion.codeExample.before}`);
    lines.push(`  After:  ${suggestion.codeExample.after}`);
  }

  lines.push('');
  lines.push('## Live DOM State');
  lines.push(`URL: ${dom.url}`);

  if (dom.lcpElement) {
    const el = dom.lcpElement;
    lines.push(`LCP element: <${el.tag}${el.id ? ' id="' + el.id + '"' : ''}${el.classes.length ? ' class="' + el.classes.join(' ') + '"' : ''}>`);
    if (el.src) lines.push(`  src: ${el.src}`);
    if (el.textPreview) lines.push(`  text: "${el.textPreview}"`);
  }

  if (dom.blockingResources.length > 0) {
    lines.push('Render-blocking resources:');
    for (const r of dom.blockingResources) {
      lines.push(`  <${r.tag}> ${r.src} — ${r.reason}`);
    }
  }

  if (dom.clsContributors.length > 0) {
    lines.push('CLS contributors (top 3):');
    for (const c of dom.clsContributors.slice(0, 3)) {
      lines.push(`  ${c.selector} — cumulative shift: ${c.shift.toFixed(4)}`);
    }
  }

  if (dom.thirdPartyScripts.length > 0) {
    lines.push('Third-party scripts:');
    for (const s of dom.thirdPartyScripts.slice(0, 5)) {
      const flags = [s.async ? 'async' : '', s.defer ? 'defer' : ''].filter(Boolean).join(', ') || 'synchronous';
      lines.push(`  ${s.src} [${flags}]`);
    }
  }

  lines.push('');
  lines.push('## Source Files');
  lines.push(`(${sourceFiles.length} file(s) provided from the --source directory)`);

  for (const file of sourceFiles) {
    lines.push('');
    lines.push(`### ${file.path}`);
    lines.push('```');
    lines.push(file.content);
    lines.push('```');
  }

  lines.push('');
  lines.push('Now produce the fix XML. Remember: <search> must match file content exactly.');

  return lines.join('\n');
}
