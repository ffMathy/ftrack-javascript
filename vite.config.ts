import path from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import commonjs from "@rollup/plugin-commonjs";

export default defineConfig({
  build: {
    minify: false,
    sourcemap: true,
    lib: {
      entry: path.resolve(__dirname, "source/index.ts"),
      name: "ftrack-javascript-api",
      fileName: (format) => `ftrack-javascript-api.${format}.js`,
    },
    rollupOptions: {
      // make sure to externalize deps that shouldn't be bundled
      // into your library
      external: ["moment", "uuid", "loglevel"],
      output: {
        globals: {
          "ftrack-javascript-api": "ftrack",
          moment: "moment",
          uuid: "uuid",
          loglevel: "log",
        },
      },
    },
  },
  plugins: [
    dts(),
    commonjs({ include: "./source/socket.io-websocket-only.cjs" }),
  ],
});