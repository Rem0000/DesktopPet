import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import path from 'node:path'

export default defineConfig({
  server: {
    // 允许通过 /@fs/ 读取项目内 layer-packs / assets（Live2D 贴图同源加载）
    fs: {
      allow: [path.resolve(__dirname)],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // @pixi/utils 会 import { parse, format, resolve } from 'url'
      // 用浏览器 shim（纯 JS，保证 esbuild 预构建能解析具名导出）
      url: path.resolve(__dirname, 'src/shims/node-url.js'),
    },
  },
  optimizeDeps: {
    // CJS 互操作：必须预构建，否则 eventemitter3 会报无 default export
    // 同时会拖入 @pixi/utils → url shim
    include: [
      'pixi.js',
      'pixi-live2d-display',
      'pixi-live2d-display/cubism2',
      'pixi-live2d-display/cubism4',
      'eventemitter3',
      'earcut',
      '@pixi/utils',
    ],
    esbuildOptions: {
      // 预构建阶段也应用 alias（Vite 默认会对 optimizeDeps 用 resolve.alias）
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        manager: path.resolve(__dirname, 'manager.html'),
        chat: path.resolve(__dirname, 'chat.html'),
        novel: path.resolve(__dirname, 'novel.html'),
      },
    },
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              // C/C++ 原生模块不能被 Rollup 正确打包，需从 node_modules 运行时加载
              external: [
                '@xenova/transformers',
                'onnxruntime-node',
                'onnxruntime-common',
                'sharp',
              ],
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
      },
      renderer: {},
    }),
  ],
})
