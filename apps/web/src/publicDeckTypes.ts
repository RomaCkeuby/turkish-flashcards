/** Public source data only. Personal changes and progress never belong in this format. */
export type PublicCardSource = {
  name: string;
  url: string;
  license: string;
  purpose: "entry" | "example" | "exampleTranslation";
};

export type PublicCardEntry = {
  key: string;
  turkish: string;
  russian: string;
  partOfSpeech: string;
  category: string;
  tags: string[];
  exampleTurkish: string;
  exampleRussian: string;
  sources: PublicCardSource[];
};

export type PublicDeckManifest = {
  schemaVersion: 1;
  version: string;
  recordCount: number;
  file: string;
  sha256: string;
};
