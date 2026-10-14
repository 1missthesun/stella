export type RawElement = {
  ref: string;
  role: string;
  name: string;
  id?: string;
  testId?: string;
  href?: string;
  checked?: boolean;
  disabled?: boolean;
  sensitive?: boolean;
};

export type CollectElementsArgs = { attribute: string; max: number; sensitive: string };

export type CollectElements = (body: Element, args: CollectElementsArgs) => RawElement[];

export declare const collectElements: CollectElements;
