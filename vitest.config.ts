import { defineConfig } from 'vitest/config';

// css.include: tests read public/assets/app.css as text (?raw); Vitest otherwise blanks CSS imports
export default defineConfig({ test: { include: ['tests/unit/**/*.test.ts', 'src/modules/**/*.test.ts'], css: { include: [/public\/assets\/(app|tokens)\.css/, /src\/styles\/ui\.css/] } } });
