const RESET = '\x1b[0m';
const CYAN  = '\x1b[36m';
const DIM   = '\x1b[2m';

export class ProgressBar {
  private current = 0;
  private readonly width = 30;

  constructor(private readonly total: number, private readonly label: string) {}

  tick(n = 1): void {
    this.current = Math.min(this.current + n, this.total);
    this.render();
  }

  complete(): void {
    this.current = this.total;
    this.render();
    process.stdout.write('\n');
  }

  private render(): void {
    const pct   = this.total === 0 ? 1 : this.current / this.total;
    const filled = Math.round(pct * this.width);
    const empty  = this.width - filled;
    const bar    = `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
    const line   = `\r${CYAN}${this.label}${RESET} ${DIM}[${bar}]${RESET} ${this.current}/${this.total}`;
    process.stdout.write(line);
  }
}
