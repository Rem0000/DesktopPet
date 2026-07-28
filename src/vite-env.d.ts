/// <reference types="vite/client" />

export {}

import type { PetAPI } from '../electron/preload'

declare global {
  interface Window {
    petAPI: PetAPI
    PIXI?: unknown
    Live2DCubismCore?: unknown
  }
}

declare module '*.css'

declare module 'pixi-live2d-display/cubism4' {
  import type { DisplayObject } from 'pixi.js'
  export class Live2DModel extends DisplayObject {
    static from(
      source: string | object,
      options?: object,
    ): Promise<Live2DModel>
    internalModel?: {
      coreModel?: {
        setParameterValueById?: (id: string, value: number) => void
      }
    }
    width: number
    height: number
    anchor: { set: (x: number, y: number) => void }
    scale: { set: (s: number) => void }
    x: number
    y: number
    motion: (group: string, index?: number) => Promise<unknown>
    destroy: () => void
  }
}

