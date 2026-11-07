/** 各スケッチの sketches/<slug>/meta.ts が default export する情報 */
export interface SketchMeta {
  title: string;
  description: string;
  /** YYYY-MM-DD。一覧は新しい順に並ぶ */
  date: string;
  tags?: string[];
}

export const defineSketch = (m: SketchMeta): SketchMeta => m;
