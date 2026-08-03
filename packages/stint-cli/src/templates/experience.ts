import type { StintConfig } from "@macworks/stint/schema";

export function renderExperienceModule(config: StintConfig): string {
  const literal = JSON.stringify(config, null, 2);
  return `import type { StintConfig } from "@macworks/stint/schema";\n\nexport const stintConfig = ${literal} as const satisfies StintConfig;\n`;
}
