import { defineConfig, type Options } from "tsup";

export default defineConfig((options: Options) => {
  console.log(process.env.NODE_ENV);

  if (process.env.NODE_ENV === "production") {
    return {
      entry: ["src/index.ts"],
      format: ["esm", "cjs"],
      clean: true,
      dts: true,
      bundle: true,
    };
  } else {
    return {
      entry: ["src/index.ts"],
      format: ["esm", "cjs", "iife"],
      clean: true,
      globalName: "venn2",
      outDir: "dev_build",
      dts: true,
      bundle: true,
    };

  }
});
