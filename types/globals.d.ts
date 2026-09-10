declare const THREE: any;
declare const ForceGraph3D: any;
declare const jsyaml: {
  load(text: string): any;
  dump(value: unknown, options?: { lineWidth?: number }): string;
};

interface Window {
  MigTheme: { choose(choice: string): void; stored(): string | null; apply(theme: string): void };
  gitRange: unknown;
  __mig: Record<string, unknown>;
}
